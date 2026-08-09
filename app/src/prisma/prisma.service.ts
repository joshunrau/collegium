import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import { EnvService } from '@/config/env/env.service.ts';

import { PrismaClient } from './generated/client.ts';

const BUSY_TIMEOUT_MS = 5000;

@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown, OnModuleInit {
  constructor(envService: EnvService) {
    super({ adapter: new PrismaBetterSqlite3({ url: envService.get('DATABASE_URL') }) });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // both pragmas return a row, so neither can go through $executeRaw
    await this.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await this.$queryRawUnsafe(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  }
}
