import type { CollectionQuery, CollectionRecord, ToolsetCollection } from '@collegium/core/toolsets';
import { Injectable } from '@nestjs/common';
import { chunk } from 'es-toolkit';
import type { z } from 'zod';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import { PrismaService } from '@/prisma/prisma.service.ts';
import type { Model, ModelRow } from '@/prisma/prisma.types.ts';
import { createRecordId, isUniqueConstraintViolation } from '@/prisma/prisma.utils.ts';

import { compileCollectionQuery } from './toolset-storage.utils.ts';

/** SQLite binds at most 999 parameters per statement, so matched ids are read back in batches under that */
const ID_BATCH_SIZE = 500;

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

  collection<TSchema extends z.ZodObject>(
    namespace: string,
    collection: string,
    schema: TSchema
  ): ToolsetCollection<TSchema> {
    const whereId = (id: string) => ({ namespace_collection_id: { collection, id, namespace } });
    const toRecord = (row: ModelRow<'ToolsetRecord'>): CollectionRecord<z.output<TSchema>> => ({
      ...schema.parse(row.payload.value),
      createdAt: row.createdAt,
      id: row.id,
      updatedAt: row.updatedAt
    });
    const matchIds = async (query: CollectionQuery<CollectionRecord<z.output<TSchema>>>): Promise<string[]> => {
      const { params, sql } = compileCollectionQuery({ collection, namespace }, query);
      const matches = await this.prisma.$queryRawUnsafe<{ id: string }[]>(sql, ...params);
      return matches.map((match) => match.id);
    };
    return {
      create: async ({ id = createRecordId(), ...data }) => {
        const payload = { value: schema.parse(data) };
        try {
          return toRecord(await this.records.create({ data: { collection, id, namespace, payload } }));
        } catch (error) {
          if (isUniqueConstraintViolation(error)) {
            throw new Error(`storage collection "${namespace}::${collection}" already holds a record with id "${id}"`);
          }
          throw error;
        }
      },
      deleteById: async (id) => {
        const { count } = await this.records.deleteMany({ where: { collection, id, namespace } });
        return count > 0;
      },
      findById: async (id) => {
        const row = await this.records.findUnique({ where: whereId(id) });
        return row === null ? null : toRecord(row);
      },
      findFirst: async (query = {}) => {
        const [id] = await matchIds({ ...query, limit: 1 });
        if (id === undefined) {
          return null;
        }
        const row = await this.records.findUnique({ where: whereId(id) });
        return row === null ? null : toRecord(row);
      },
      findMany: async (query = {}) => {
        const ids = await matchIds(query);
        const rowsById = new Map<string, ModelRow<'ToolsetRecord'>>();
        for (const batch of chunk(ids, ID_BATCH_SIZE)) {
          const rows = await this.records.findMany({ where: { collection, id: { in: batch }, namespace } });
          for (const row of rows) {
            rowsById.set(row.id, row);
          }
        }
        return ids.flatMap((id) => {
          const row = rowsById.get(id);
          return row === undefined ? [] : [toRecord(row)];
        });
      },
      updateById: async (id, patch) => {
        const row = await this.records.findUnique({ where: whereId(id) });
        if (row === null) {
          return null;
        }
        const payload = { value: schema.parse({ ...schema.parse(row.payload.value), ...patch }) };
        return toRecord(await this.records.update({ data: { payload }, where: whereId(id) }));
      }
    };
  }
}
