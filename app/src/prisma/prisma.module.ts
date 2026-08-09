import { Module } from '@nestjs/common';
import type { DynamicModule, FactoryProvider } from '@nestjs/common';

import { Prisma } from './generated/client.ts';
import { PrismaService } from './prisma.service.ts';
import { getModelKey, getModelToken } from './prisma.utils.ts';

@Module({})
export class PrismaModule {
  static forRoot(): DynamicModule {
    const modelProviders: FactoryProvider[] = Object.values(Prisma.ModelName).map((modelName) => ({
      inject: [PrismaService],
      provide: getModelToken(modelName),
      useFactory: (prismaService: PrismaService): unknown => {
        return prismaService[getModelKey(modelName)];
      }
    }));
    const modelTokens = modelProviders.map((provider) => provider.provide);
    return {
      exports: [PrismaService, ...modelTokens],
      global: true,
      module: PrismaModule,
      providers: [PrismaService, ...modelProviders]
    };
  }
}
