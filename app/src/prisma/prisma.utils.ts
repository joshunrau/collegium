import { uncapitalize } from '@collegium/core/utils';
import { createId } from '@paralleldrive/cuid2';

import { Prisma } from './generated/client.ts';

import type { PrismaModelKey, PrismaModelName } from './prisma.types.ts';

/** for a row whose id must exist before the row does; matches the schema's `@default(cuid(2))` so app-minted and store-minted ids are one shape */
export function createRecordId(): string {
  return createId();
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function getModelToken<T extends PrismaModelName>(modelName: T): `${T}PrismaModel` {
  return `${modelName}PrismaModel`;
}

export function getModelKey<T extends PrismaModelName>(modelName: T): PrismaModelKey<T> {
  return uncapitalize(modelName);
}
