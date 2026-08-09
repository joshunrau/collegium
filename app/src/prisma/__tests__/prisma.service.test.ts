import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvService } from '@/config/env/env.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

const PrismaBetterSqlite3 = vi.hoisted(() => {
  return vi.fn(function (this: { options: unknown }, options: unknown) {
    this.options = options;
  });
});

const $connect = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const $disconnect = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const $queryRawUnsafe = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@prisma/adapter-better-sqlite3', () => ({ PrismaBetterSqlite3 }));

vi.mock('../generated/client.ts', () => ({
  PrismaClient: class {
    $connect = $connect;
    $disconnect = $disconnect;
    $queryRawUnsafe = $queryRawUnsafe;
    constructor(public readonly options: unknown) {}
  }
}));

const { PrismaService } = await import('../prisma.service.ts');

describe('PrismaService', () => {
  let envService: MockedInstance<EnvService>;
  let prismaService: InstanceType<typeof PrismaService>;

  beforeEach(async () => {
    envService = MockFactory.createMock(EnvService);
    envService.get.mockImplementation((key) => {
      if (key !== 'DATABASE_URL') {
        throw new Error(`Unexpected key: ${key}`);
      }
      return 'file:///dev/null';
    });

    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: EnvService, useValue: envService }, PrismaService]
    }).compile();

    prismaService = moduleRef.get(PrismaService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should configure a better-sqlite3 adapter from the DATABASE_URL env var', () => {
    expect(envService.get).toHaveBeenCalledExactlyOnceWith('DATABASE_URL');
    expect(PrismaBetterSqlite3).toHaveBeenCalledExactlyOnceWith({ url: 'file:///dev/null' });
  });

  it('should connect on module init', async () => {
    await prismaService.onModuleInit();
    expect($connect).toHaveBeenCalledOnce();
  });

  it('should enable WAL and a busy timeout on module init, since per-channel concurrency means concurrent writers', async () => {
    await prismaService.onModuleInit();
    expect($queryRawUnsafe).toHaveBeenCalledWith('PRAGMA journal_mode = WAL');
    expect($queryRawUnsafe).toHaveBeenCalledWith('PRAGMA busy_timeout = 5000');
  });

  it('should disconnect on application shutdown', async () => {
    await prismaService.onApplicationShutdown();
    expect($disconnect).toHaveBeenCalledOnce();
  });
});
