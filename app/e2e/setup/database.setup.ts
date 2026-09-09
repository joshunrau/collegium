import type { TestProject } from 'vitest/node';

import { createDatabaseTemplate } from '../support/database.ts';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { dispose, template } = await createDatabaseTemplate();
  project.provide('databaseTemplate', template);
  return dispose;
}
