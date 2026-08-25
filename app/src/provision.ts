/**
 * Provisioning as its own process, run to completion before the app is imported. Separate because
 * the two do opposite things: this converges Mattermost onto what config.json declares, and boot
 * refuses anything that does not already match. Merging them would leave boot verifying its own
 * writes, and a half-finished convergence indistinguishable from a misconfiguration.
 *
 * The administrator's credentials reach this process and no further — the root prologue drops them
 * from the environment before importing the app.
 */

import { $ProvisioningEnv } from '@collegium/config';
import { NestFactory } from '@nestjs/core';

// the process entries predate DI, and a failure before the app exists must still land as JSON
import { JSONLogger } from './logging/adapters/json.logger.ts';
import { ProvisionModule } from './provision.module.ts';
import { ProvisioningService } from './provisioning/provisioning.service.ts';

const logger = new JSONLogger('Provision');

try {
  const env = $ProvisioningEnv.parse(process.env);
  const context = await NestFactory.createApplicationContext(ProvisionModule, { bufferLogs: true });
  try {
    await context.get(ProvisioningService).reconcile({
      email: env.MATTERMOST_ADMIN_EMAIL,
      password: env.MATTERMOST_ADMIN_PASSWORD,
      username: env.MATTERMOST_ADMIN_USERNAME
    });
  } finally {
    await context.close();
  }
} catch (error) {
  logger.error(error);
  process.exit(1);
}
