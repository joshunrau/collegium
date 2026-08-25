import type { Config } from '@collegium/config';
import { Test } from '@nestjs/testing';
import type { PartialDeep } from 'type-fest';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';

import { InferenceRegistry } from '../inference.registry.ts';
import { TransportRetrier } from '../resilience/transport.retrier.ts';

async function createRegistry(overrides: PartialDeep<Config>): Promise<InferenceRegistry> {
  const moduleRef = await Test.createTestingModule({
    providers: [InferenceRegistry, { provide: ConfigService, useValue: createConfigServiceMock(overrides) }]
  }).compile();
  return moduleRef.get(InferenceRegistry);
}

describe('InferenceRegistry', () => {
  let inferenceRegistry: InferenceRegistry;

  beforeEach(async () => {
    inferenceRegistry = await createRegistry({
      app: { inferenceTimeoutMs: 15_000 },
      models: { deepseek: { apiKey: 'key', baseUrl: 'https://example.com' } }
    });
  });

  it('should return a retry-wrapped client for a configured model provider', () => {
    expect(inferenceRegistry.getClientForModel({ name: 'deepseek-v4-flash', provider: 'deepseek' })).toBeInstanceOf(
      TransportRetrier
    );
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
    const registry = await createRegistry({ models: { openrouter: undefined } });
    expect(() => {
      return registry.getClientForModel({ name: 'anthropic/claude-sonnet-5', provider: 'openrouter' });
    }).toThrow('model provider "openrouter" is not configured');
  });
});
