import type { DynamicModule } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../generated/client.ts';
import { PrismaModule } from '../prisma.module.ts';
import { PrismaService } from '../prisma.service.ts';

describe('PrismaModule', () => {
  let module: DynamicModule;

  beforeAll(() => {
    module = PrismaModule.forRoot();
  });

  it('should export one provider per model in the schema', () => {
    const modelTokens = Object.values(Prisma.ModelName).map((modelName) => `${modelName}PrismaModel`);
    expect(modelTokens).toContain('TurnEventPrismaModel');
    expect(module.exports).toStrictEqual([PrismaService, ...modelTokens]);
  });

  it('should be global, so a model can be injected without importing the module', () => {
    expect(module.global).toBe(true);
  });

  it('should resolve a model provider to the matching delegate on PrismaService', () => {
    const provider: any = module.providers!.find((provider: any) => provider.provide === 'TurnEventPrismaModel');
    expect(provider.useFactory({ turnEvent: 'TURN_EVENT' })).toBe('TURN_EVENT');
  });
});
