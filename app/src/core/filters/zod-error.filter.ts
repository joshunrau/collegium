import { BadRequestException, Catch } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { ZodError } from 'zod';

/**
 * Every callback perimeter parses its body with Zod and lets the error escape, which the default
 * filter reports as a 500. The body was malformed, not the process — the caller is owed a 400, and
 * a status that names the wrong party sends whoever is debugging it to the wrong side of the wire.
 */
@Catch(ZodError)
export class ZodErrorFilter extends BaseExceptionFilter {
  override catch(exception: ZodError, host: ArgumentsHost): void {
    super.catch(new BadRequestException({ issues: exception.issues, kind: 'malformed-body' }), host);
  }
}
