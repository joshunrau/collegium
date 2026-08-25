import * as fs from 'node:fs/promises';
import * as module from 'node:module';
import * as path from 'node:path';

import { Command } from 'commander';
import prettier from 'prettier';

module.register('@swc-node/register/esm', import.meta.url);

const { toConfigJsonSchema } = await import('@collegium/config');
const { $Config } = await import('@/config/config.schemas.ts');
const { GRANTABLE_TOOLSETS } = await import('@/tools/tools.toolsets.ts');

const OUTPUT_PATH = path.resolve(import.meta.dirname, '../config.schema.json');

async function formatAsProject(source: string, filepath: string): Promise<string> {
  const config = await prettier.resolveConfig(filepath);
  if (!config) {
    throw new Error(`Failed to resolve prettier config for ${filepath}`);
  }
  return prettier.format(source, { ...config, filepath });
}

const program = new Command()
  .name('schema')
  .description(`Generate the JSON Schema for config.json (${path.basename(OUTPUT_PATH)}).`);

program
  .command('build')
  .summary('write the config JSON Schema to disk')
  .description('Convert the config Zod schema to draft-7 JSON Schema, format it with prettier, and overwrite the file.')
  .action(async () => {
    const schema = toConfigJsonSchema($Config, GRANTABLE_TOOLSETS);
    await fs.writeFile(OUTPUT_PATH, await formatAsProject(JSON.stringify(schema), OUTPUT_PATH));
  });

program.parse();
