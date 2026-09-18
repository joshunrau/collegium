import type { $ModelRef, AgentDefinition } from '@collegium/config';
import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';
import type { ProviderName } from '@/core/core.types.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import { OpenAICompatibleClient } from './adapters/openai-compatible.client.ts';
import { CREDENTIAL_PROBE_DEADLINE_MS } from './inference.constants.ts';
import { bootProbeRequest, describeCredentialRefusal, describeInferenceFailure } from './inference.utils.ts';
import { TransportRetrier } from './resilience/transport.retrier.ts';

import type { InferenceClient } from './inference.client.ts';
import type { CredentialProbeOutcome, ProviderCredentialFailure } from './inference.types.ts';

type CredentialProbe = {
  readonly agentUsernames: string[];
  readonly model: $ModelRef;
};

@Injectable()
export class InferenceRegistry {
  private readonly adapters: { [K in ProviderName]?: InferenceClient };

  constructor(
    configService: ConfigService,
    private readonly loggingService: LoggingService
  ) {
    const providers = configService.get('providers');
    const { retry, timeoutMs } = configService.get('inference');
    this.adapters = {};
    for (const provider of Object.keys(providers) as ProviderName[]) {
      const credentials = providers[provider];
      if (credentials) {
        this.adapters[provider] = new TransportRetrier(
          new OpenAICompatibleClient({ ...credentials, timeoutMs }, provider),
          retry
        );
      }
    }
  }

  /** §7.3 — one probe per model an agent names, all under one deadline; a provider that rejects the key as unauthorized stops boot */
  async assertCredentialsVerified(agents: readonly AgentDefinition[]): Promise<void> {
    const probes = new Map<string, CredentialProbe>();
    for (const agent of agents) {
      const key = `${agent.model.provider}:${agent.model.name}`;
      const probe = probes.get(key) ?? { agentUsernames: [], model: agent.model };
      probe.agentUsernames.push(agent.username);
      probes.set(key, probe);
    }
    const deadline = AbortSignal.timeout(CREDENTIAL_PROBE_DEADLINE_MS);
    const probed = await Promise.all(
      Array.from(probes.values(), async ({ agentUsernames, model }) => ({
        agentUsernames,
        model,
        outcome: await this.probeCredential(model, deadline)
      }))
    );
    const refusals: ProviderCredentialFailure[] = [];
    let verified = 0;
    for (const { agentUsernames, model, outcome } of probed) {
      if (outcome.kind === 'verified') {
        verified += 1;
      } else if (outcome.kind === 'refused') {
        refusals.push({ agentUsernames, model: model.name, provider: model.provider, status: outcome.status });
      } else {
        this.loggingService.warn(`credentials unverified for ${model.provider} ${model.name}: ${outcome.reason}`);
      }
    }
    this.loggingService.log(
      `credential probes: ${verified} verified, ${probed.length - verified - refusals.length} unverified, ${refusals.length} refused`
    );
    if (refusals.length > 0) {
      throw new Error(
        `provider credential verification failed at boot: ${refusals.map(describeCredentialRefusal).join('; ')}`
      );
    }
  }

  getClientForModel(model: $ModelRef): InferenceClient {
    const client = this.adapters[model.provider];
    if (!client) {
      throw new Error(`model provider "${model.provider}" is not configured`);
    }
    return client;
  }

  private async probeCredential(model: $ModelRef, deadline: AbortSignal): Promise<CredentialProbeOutcome> {
    if (deadline.aborted) {
      return { kind: 'unverified', reason: 'the probe deadline passed before this probe started' };
    }
    const result = await this.getClientForModel(model).complete(bootProbeRequest(model), { signal: deadline });
    if (result.success) {
      return { kind: 'verified' };
    }
    if (result.error.kind === 'provider' && (result.error.status === 401 || result.error.status === 403)) {
      return { kind: 'refused', status: result.error.status };
    }
    return { kind: 'unverified', reason: describeInferenceFailure(result.error) };
  }
}
