import type { CollectionRecord, ToolsetCollection } from '@collegium/core/toolsets';
import { Injectable } from '@nestjs/common';
import type { z } from 'zod';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import { PrismaService } from '@/prisma/prisma.service.ts';
import type { Model, ModelRow } from '@/prisma/prisma.types.ts';
import { createRecordId, isUniqueConstraintViolation } from '@/prisma/prisma.utils.ts';

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
      findMany: async (query = {}) => {
        const { params, sql } = compileCollectionQuery({ collection, namespace }, query);
        const matches = await this.prisma.$queryRawUnsafe<{ id: string }[]>(sql, ...params);
        const rows = await this.records.findMany({
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          where: { collection, id: { in: matches.map((match) => match.id) }, namespace }
        });
        return rows.map(toRecord);
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
