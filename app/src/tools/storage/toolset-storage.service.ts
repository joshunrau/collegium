import type { ToolsetCollection } from '@collegium/core/toolsets';
import { Injectable } from '@nestjs/common';
import type { z } from 'zod';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import { PrismaService } from '@/prisma/prisma.service.ts';
import type { Model } from '@/prisma/prisma.types.ts';

import { compileCollectionQuery } from './toolset-storage.utils.ts';

/**
 * Every handle closes over its namespace and collection names, so a toolset physically cannot
 * address rows outside its own scope. Values are validated on write and parsed on read: a row
 * written by an older version of the toolset that no longer matches the schema fails loudly
 * rather than leaking a stale shape into the tool.
 */
@Injectable()
export class ToolsetStorageService {
  constructor(
    @InjectModel('ToolsetRecord') private readonly records: Model<'ToolsetRecord'>,
    private readonly prisma: PrismaService
  ) {}

  collection(namespace: string, collection: string, schema: z.ZodType): ToolsetCollection<unknown> {
    const uniqueWhere = (key: string) => ({ namespace_collection_key: { collection, key, namespace } });
    const parseRows = (rows: { key: string; payload: PrismaJson.ToolsetRecordPayload }[]) =>
      rows.map((row) => ({ key: row.key, value: schema.parse(row.payload.value) }));
    return {
      delete: async (key) => {
        const { count } = await this.records.deleteMany({ where: { collection, key, namespace } });
        return count > 0;
      },
      find: async (query) => {
        const { params, sql } = compileCollectionQuery({ collection, namespace }, query);
        const matches = await this.prisma.$queryRawUnsafe<{ id: string }[]>(sql, ...params);
        const rows = await this.records.findMany({
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          where: { id: { in: matches.map((match) => match.id) } }
        });
        return parseRows(rows);
      },
      get: async (key) => {
        const row = await this.records.findUnique({ where: uniqueWhere(key) });
        return row === null ? null : schema.parse(row.payload.value);
      },
      list: async () => {
        const rows = await this.records.findMany({ orderBy: { createdAt: 'asc' }, where: { collection, namespace } });
        return parseRows(rows);
      },
      put: async (key, value) => {
        const payload = { value: schema.parse(value) };
        await this.records.upsert({
          create: { collection, key, namespace, payload },
          update: { payload },
          where: uniqueWhere(key)
        });
      }
    };
  }
}
