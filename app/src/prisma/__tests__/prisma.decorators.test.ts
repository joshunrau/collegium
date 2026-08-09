// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck - remove this once the first model is added

import { describe, expect, it, vi } from 'vitest';

import { InjectModel } from '../prisma.decorators.js';

import type { PrismaModelName } from '../prisma.types.js';

const Inject = vi.hoisted(() => vi.fn(() => 'INJECTED'));
const getModelToken = vi.hoisted(() => vi.fn((modelName: PrismaModelName) => `MockToken_${modelName}`));

vi.mock('@nestjs/common', () => ({ Inject }));

vi.mock('../prisma.utils.js', () => ({ getModelToken }));

describe('InjectModel', () => {
  it('should call Inject with the correct model token', () => {
    const modelName: PrismaModelName = 'Cat';
    const model = InjectModel(modelName);
    expect(getModelToken).toHaveBeenCalledWith(modelName);
    expect(Inject).toHaveBeenCalledWith(`MockToken_${modelName}`);
    expect(model).toBe('INJECTED');
  });
});
