/* eslint-disable no-console -- this file's job is rebinding the global console */

import { Console } from 'node:console';
import { Writable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { match } from 'ts-pattern';
import type { Simplify } from 'type-fest';

import type { $LogLevel } from '@/core/core.schemas.ts';

import { LoggingService } from '../logging.service.ts';

type ConsoleMethod = Simplify<Exclude<Extract<keyof Console, string>, 'Console'>>;

type ConsoleRedirection = {
  level: $LogLevel;
  methods: ConsoleMethod[];
};

type RedirectedLevel = Extract<(typeof CONSOLE_REDIRECTIONS)[number]['level'], $LogLevel>;

const CONSOLE_REDIRECTIONS = [
  {
    level: 'debug',
    methods: [
      'count',
      'countReset',
      'debug',
      'dir',
      'dirxml',
      'group',
      'groupCollapsed',
      'groupEnd',
      'info',
      'log',
      'table',
      'time',
      'timeEnd',
      'timeLog'
    ]
  },
  {
    level: 'error',
    methods: ['assert', 'error', 'trace']
  },
  {
    level: 'warn',
    methods: ['warn']
  }
] as const satisfies ConsoleRedirection[];

@Injectable()
export class ConsoleBridge implements OnApplicationShutdown, OnModuleInit {
  private readonly originalMethods = new Map<ConsoleMethod, Console[ConsoleMethod]>();

  constructor(private readonly loggingService: LoggingService) {}

  onApplicationShutdown(): void {
    for (const [method, original] of this.originalMethods) {
      // eslint accepts this for some reason, but tsc does not
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      (console[method] as Console[ConsoleMethod]) = original;
    }
    this.originalMethods.clear();
  }

  onModuleInit(): void {
    for (const { level, methods } of CONSOLE_REDIRECTIONS) {
      const internalConsole = this.createInternalConsole(level);
      for (const method of methods) {
        this.patchMethod(method, internalConsole);
      }
    }
  }

  private createInternalConsole(level: RedirectedLevel): Console {
    const forward = (message: string): void => {
      match(level)
        .with('debug', () => this.loggingService.debug(message))
        .with('error', () => this.loggingService.error(message))
        .with('warn', () => this.loggingService.warn(message))
        .exhaustive();
    };
    const sink = new Writable({
      write: (chunk: Buffer, _encoding, done): void => {
        const message = chunk.toString().replace(/\n$/, '');
        if (message) {
          forward(message);
        }
        done();
      }
    });
    return new Console({ colorMode: false, stderr: sink, stdout: sink });
  }

  private patchMethod<TMethod extends ConsoleMethod>(method: TMethod, internalConsole: Console): void {
    this.originalMethods.set(method, console[method]);
    console[method] = internalConsole[method];
  }
}
