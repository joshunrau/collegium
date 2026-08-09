import { errorToJSON } from '@collegium/core/utils';
import type { LoggerService } from '@nestjs/common';
import { gray, green, red, yellow } from 'colorette';
import { isErrorLike } from 'serialize-error';

import { LOG_LEVELS } from '@/core/core.constants.ts';
import type { $LogLevel } from '@/core/core.schemas.ts';

type LevelStyle = {
  color: (text: string) => string;
  stream: NodeJS.WriteStream;
};

type LogEntryBase = {
  context?: string;
  level: $LogLevel;
  timestamp: string;
};

type ErrorLogEntry = LogEntryBase & {
  error: ReturnType<typeof errorToJSON>;
};

type MessageLogEntry = LogEntryBase & {
  message: unknown;
};

export class JSONLogger implements LoggerService {
  private readonly context?: string;
  private readonly style: { [L in $LogLevel]: LevelStyle } = {
    debug: { color: gray, stream: process.stdout },
    error: { color: red, stream: process.stderr },
    info: { color: green, stream: process.stdout },
    warn: { color: yellow, stream: process.stderr }
  };
  private readonly threshold: number;

  constructor(context?: string, logLevel: $LogLevel = 'info') {
    this.context = context;
    this.threshold = this.rank(logLevel);
  }

  debug(message: any, context?: string): void;
  debug(message: any, ...optionalParams: [...any, string?]): void;
  debug(...args: unknown[]): void {
    const { context, messages } = this.getContextAndMessagesToPrint(args);
    this.write(messages, { context, level: 'debug' });
  }

  error(message: any, stackOrContext?: string): void;
  error(message: any, stack?: string, context?: string): void;
  error(message: any, ...optionalParams: [...any, string?, string?]): void;
  error(...args: unknown[]): void {
    const { context, messages } = this.getContextAndMessagesToPrint(args);
    this.write(messages, { context, level: 'error' });
  }

  fatal(message: any, context?: string): void;
  fatal(message: any, ...optionalParams: [...any, string?]): void;
  fatal(...args: unknown[]): void {
    const { context, messages } = this.getContextAndMessagesToPrint(args);
    this.write(messages, { context, level: 'error' });
  }

  log(message: any, context?: string): void;
  log(message: any, ...optionalParams: [...any, string?]): void;
  log(...args: unknown[]): void {
    const { context, messages } = this.getContextAndMessagesToPrint(args);
    this.write(messages, { context, level: 'info' });
  }

  verbose(message: any, context?: string): void;
  verbose(message: any, ...optionalParams: [...any, string?]): void;
  verbose(...args: unknown[]): void {
    const { context, messages } = this.getContextAndMessagesToPrint(args);
    this.write(messages, { context, level: 'debug' });
  }

  warn(message: any, context?: string): void;
  warn(message: any, ...optionalParams: [...any, string?]): void;
  warn(...args: unknown[]): void {
    const { context, messages } = this.getContextAndMessagesToPrint(args);
    this.write(messages, { context, level: 'warn' });
  }

  private getContextAndMessagesToPrint(args: unknown[]): {
    context: string | undefined;
    messages: unknown[];
  } {
    const context = args.at(-1);
    if (args.length <= 1 || typeof context !== 'string') {
      return { context: this.context, messages: args };
    }
    return {
      context,
      messages: args.slice(0, args.length - 1)
    };
  }

  private rank(level: $LogLevel) {
    return LOG_LEVELS.indexOf(level);
  }

  private write(messages: unknown[], { context, level }: { context?: string; level: $LogLevel }) {
    if (this.rank(level) < this.threshold) {
      return;
    }
    const { color, stream } = this.style[level];

    for (const message of messages) {
      const base = {
        ...(context ? { context } : {}),
        level,
        timestamp: new Date().toISOString()
      } satisfies LogEntryBase;
      const entry = isErrorLike(message)
        ? ({ ...base, error: errorToJSON(message) } satisfies ErrorLogEntry)
        : ({ ...base, message } satisfies MessageLogEntry);

      stream.write(color(`${JSON.stringify(entry, null, 2)}\n`));
    }
  }
}
