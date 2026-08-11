import type { Provider } from '@nestjs/common';
import { vi } from 'vitest';
import type { Mock } from 'vitest';

/**
 * All the factory needs of a class: the injection token it doubles as, and the prototype naming the
 * methods to fake. Stated without a construct signature so a class whose constructor is private —
 * one reachable only through its own async factory — can still be mocked. Overriding `prototype`
 * is what keeps it typed rather than `Function`'s own `any`.
 */
// the built-in is named on purpose: Nest's InjectionToken admits `Function`, and this must stay
// assignable to it
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type ClassToken<T> = Omit<Function, 'prototype'> & { prototype: T };

export type MockedInstance<T extends object> = {
  [K in keyof T as T[K] extends (...args: any[]) => any ? K : never]: T[K] extends (...args: any[]) => any
    ? Mock<T[K]>
    : never;
};

export class MockFactory {
  static createForService<T extends object>(constructor: ClassToken<T>): Provider<MockedInstance<T>> {
    return {
      provide: constructor,
      useValue: this.createMock(constructor)
    };
  }

  static createMock<T extends object>(constructor: ClassToken<T>): MockedInstance<T> {
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
