import type { TestProject } from 'vitest/node';

import { MattermostCluster } from '../support/cluster.ts';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const cluster = new MattermostCluster();
  process.stdout.write('[e2e] starting the Mattermost cluster\n');
  const connection = await cluster.start();
  process.stdout.write(`[e2e] Mattermost cluster ready at ${connection.url}\n`);
  project.provide('cluster', connection);
  return async () => {
    await cluster.stop();
  };
}
