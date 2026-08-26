import { setSourceMapsSupport } from 'node:module';

import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.ts';
import { EnvService } from './config/env/env.service.ts';
import { ZodErrorFilter } from './core/filters/zod-error.filter.ts';
import { LoggingService } from './logging/logging.service.ts';

export async function bootstrap() {
  // off by default, and every stack trace this process reports is from emitted JavaScript — the
  // framework's own `dist` and, once compiled, each plugin's bundle. Before the factory, because a
  // plugin is compiled and imported while its module's providers are being constructed.
  setSourceMapsSupport(true);

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true
  });

  const envService = app.get(EnvService);
  const loggingService = await app.resolve(LoggingService);

  app.useLogger(loggingService);
  app.useGlobalFilters(new ZodErrorFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableShutdownHooks();
  await app.listen(envService.get('APP_PORT'), envService.get('APP_HOST'));
}
