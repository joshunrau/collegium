// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck - remove this once the first model is added

import { describe, expect, it } from 'vitest';

import { getModelKey, getModelToken } from '../prisma.utils.ts';

describe('getModelToken', () => {
  it('should append the PrismaModel suffix to the model name', () => {
    expect(getModelToken('Cat')).toBe('CatPrismaModel');
  });
});

describe('getModelKey', () => {
  it('should uncapitalize the model name', () => {
    expect(getModelKey('Cat')).toBe('cat');
  });
});
