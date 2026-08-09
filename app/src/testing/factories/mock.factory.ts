import type { Provider } from '@nestjs/common';
import type { AbstractClass } from 'type-fest';
import { vi } from 'vitest';
import type { Mock } from 'vitest';

export type MockedInstance<T extends object> = {
  [K in keyof T as T[K] extends (...args: any[]) => any ? K : never]: T[K] extends (...args: any[]) => any
    ? Mock<T[K]>
    : never;
};

export class MockFactory {
  static createForService<T extends object>(constructor: AbstractClass<T>): Provider<MockedInstance<T>> {
    return {
      provide: constructor,
      useValue: this.createMock(constructor)
    };
  }

  static createMock<T extends object>(constructor: AbstractClass<T>): MockedInstance<T> {
    const target: { [key: string]: unknown } = {};
    this.getAllPropertyNames(constructor.prototype)
      .filter((property) => property !== 'constructor')
      .forEach((property) => {
        target[property] = vi.fn();
      });
    return new Proxy(target, {
      get: (object, property) => {
        if (typeof property === 'symbol') {
          return undefined;
        }
        // a fabricated 'then' would make the mock thenable and break every await of it
        if (property === 'then' || property === 'constructor') {
          return object[property];
        }
        object[property] ??= vi.fn();
        return object[property];
      }
    }) as MockedInstance<T>;
  }

  private static getAllPropertyNames(object: object): string[] {
    const properties = Object.getOwnPropertyNames(object);
    const prototype: unknown = Object.getPrototypeOf(object);
    if (prototype === Object.prototype) {
      return properties;
    }
    return Array.from(new Set(properties.concat(this.getAllPropertyNames(prototype as object))));
  }
}
