import { uncapitalize } from '@collegium/core/utils';

import { Prisma } from './generated/client.ts';

import type { PrismaModelKey, PrismaModelName } from './prisma.types.ts';

export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function getModelToken<T extends PrismaModelName>(modelName: T): `${T}PrismaModel` {
  return `${modelName}PrismaModel`;
}

export function getModelKey<T extends PrismaModelName>(modelName: T): PrismaModelKey<T> {
  return uncapitalize(modelName);
}
