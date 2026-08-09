import { Inject } from '@nestjs/common';

import { getModelToken } from './prisma.utils.ts';

import type { PrismaModelName } from './prisma.types.ts';

export const InjectModel = <T extends PrismaModelName>(modelName: T): ParameterDecorator & PropertyDecorator => {
  return Inject(getModelToken(modelName));
};
