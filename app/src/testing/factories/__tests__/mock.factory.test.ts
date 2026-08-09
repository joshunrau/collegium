import { describe, expect, it } from 'vitest';

import { MockFactory } from '../mock.factory.ts';

class Animal {
  eat() {
    return;
  }
}

class Cat extends Animal {
  meow() {
    return;
  }
}

describe('MockFactory', () => {
  describe('createForService', () => {
    it('should provide the correct token and mock all functions', () => {
      expect(MockFactory.createForService(Cat)).toMatchObject({
        provide: Cat,
        useValue: {
          eat: expect.any(Function),
          meow: expect.any(Function)
        }
      });
    });
  });
});
