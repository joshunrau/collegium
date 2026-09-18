import type { $Config, $ModelRef, AgentDefinition } from '@collegium/config';
import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import type { PartialDeep } from 'type-fest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { InferenceClient } from '../inference.client.ts';
import { InferenceRegistry } from '../inference.registry.ts';
import { TransportRetrier } from '../resilience/transport.retrier.ts';

import type { CompletionResult, InferenceFailure } from '../inference.types.ts';

const FLASH: $ModelRef = { name: 'deepseek-v4-flash', provider: 'deepseek' };

const PRO: $ModelRef = { name: 'deepseek-v4-pro', provider: 'deepseek' };

const ACCEPTED: Result<CompletionResult, InferenceFailure> = Result.ok({
  content: 'pong',
  kind: 'text',
  usage: undefined
});

function agent(username: string, model: $ModelRef): AgentDefinition {
  return {
    contextBudgetTokens: 8000,
    expertise: 'testing',
    model,
    personality: undefined,
    skills: [],
    systemPrompt: `You are ${username}.`,
    tools: [],
    toolSettings: {},
    username
  };
}

function refusal(status: number): Result<CompletionResult, InferenceFailure> {
  return Result.err({ kind: 'provider', message: 'no', status });
}

describe('InferenceRegistry', () => {
  let client: MockedInstance<InferenceClient>;
  let inferenceRegistry: InferenceRegistry;
  let loggingService: MockedInstance<LoggingService>;

  const createRegistry = async (overrides: PartialDeep<$Config>): Promise<InferenceRegistry> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        InferenceRegistry,
        { provide: ConfigService, useValue: createConfigServiceMock(overrides) },
        { provide: LoggingService, useValue: loggingService }
      ]
    }).compile();
    return moduleRef.get(InferenceRegistry);
  };

  beforeEach(async () => {
    client = MockFactory.createMock(InferenceClient);
    client.complete.mockResolvedValue(ACCEPTED);
    loggingService = MockFactory.createMock(LoggingService);
    inferenceRegistry = await createRegistry({
      inference: { timeoutMs: 15_000 },
      providers: { deepseek: { apiKey: 'key', baseUrl: 'https://example.com' } }
    });
  });

  it('should return a retry-wrapped client for a configured model provider', () => {
    expect(inferenceRegistry.getClientForModel(FLASH)).toBeInstanceOf(TransportRetrier);
  });

  it('should throw for an unconfigured model provider', () => {
    expect(() => {
      return inferenceRegistry.getClientForModel({
        name: 'anthropic/claude-sonnet-5',
        provider: 'openrouter'
      });
    }).toThrow('model provider "openrouter" is not configured');
  });

  it('should skip a provider key present without a configuration', async () => {
    const registry = await createRegistry({ providers: { openrouter: undefined } });
    expect(() => {
      return registry.getClientForModel({ name: 'anthropic/claude-sonnet-5', provider: 'openrouter' });
    }).toThrow('model provider "openrouter" is not configured');
  });

  describe('assertCredentialsVerified', () => {
    let probedModels: $ModelRef[];

    beforeEach(() => {
      probedModels = [];
      vi.spyOn(inferenceRegistry, 'getClientForModel').mockImplementation((model) => {
        probedModels.push(model);
        return client;
      });
    });

    it('should probe a shared model once and stop boot naming every agent it strands (§7.3)', async () => {
      client.complete.mockResolvedValue(refusal(401));
      await expect(
        inferenceRegistry.assertCredentialsVerified([agent('mira', FLASH), agent('robin', FLASH)])
      ).rejects.toThrow(
        'provider credential verification failed at boot: deepseek refused "deepseek-v4-flash" (HTTP 401), used by "mira", "robin"'
      );
      expect(client.complete).toHaveBeenCalledOnce();
    });

    it('should probe each distinct model of one provider and name only the refused pair (§7.3)', async () => {
      client.complete.mockImplementation((request) => {
        return Promise.resolve(request.model.name === PRO.name ? refusal(403) : ACCEPTED);
      });
      await expect(
        inferenceRegistry.assertCredentialsVerified([agent('mira', FLASH), agent('robin', PRO)])
      ).rejects.toThrow(
        'provider credential verification failed at boot: deepseek refused "deepseek-v4-pro" (HTTP 403), used by "robin"'
      );
      expect(client.complete).toHaveBeenCalledTimes(2);
    });

    it('should let boot continue and count a non-auth failure as unverified (§7.3)', async () => {
      client.complete.mockResolvedValue(Result.err({ kind: 'provider', message: 'busy', status: 500 }));
      await expect(inferenceRegistry.assertCredentialsVerified([agent('mira', FLASH)])).resolves.toBeUndefined();
      expect(loggingService.warn).toHaveBeenCalledWith(
        'credentials unverified for deepseek deepseek-v4-flash: the provider rejected the request: busy'
      );
      expect(loggingService.log).toHaveBeenCalledWith('credential probes: 0 verified, 1 unverified, 0 refused');
    });

    it('should issue every probe concurrently under one shared deadline', async () => {
      let accept!: (result: Result<CompletionResult, InferenceFailure>) => void;
      client.complete.mockReturnValue(new Promise((resolve) => (accept = resolve)));
      const verifying = inferenceRegistry.assertCredentialsVerified([agent('mira', FLASH), agent('robin', PRO)]);
      await vi.waitFor(() => expect(client.complete).toHaveBeenCalledTimes(2));
      const [first, second] = client.complete.mock.calls;
      expect(first?.[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(second?.[1]?.signal).toBe(first?.[1]?.signal);
      accept(ACCEPTED);
      await verifying;
    });

    it('should never probe a provider no agent names', async () => {
      await inferenceRegistry.assertCredentialsVerified([agent('mira', FLASH)]);
      expect(probedModels).toEqual([FLASH]);
      expect(loggingService.log).toHaveBeenCalledWith('credential probes: 1 verified, 0 unverified, 0 refused');
    });
  });
});
