import type { $ModelRef } from '@collegium/config';
import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';
import type { ProviderName } from '@/core/core.types.ts';

import { OpenAICompatibleClient } from './adapters/openai-compatible.client.ts';
import { TransportRetrier } from './resilience/transport.retrier.ts';

import type { InferenceClient } from './inference.client.ts';

@Injectable()
export class InferenceRegistry {
  private readonly adapters: { [K in ProviderName]?: InferenceClient };

  constructor(configService: ConfigService) {
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

  getClientForModel(model: $ModelRef): InferenceClient {
    const client = this.adapters[model.provider];
    if (!client) {
      throw new Error(`model provider "${model.provider}" is not configured`);
    }
    return client;
  }
}
