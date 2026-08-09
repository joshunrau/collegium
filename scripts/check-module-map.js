/// <reference types="node" />

// @ts-check

import * as fs from 'node:fs';
import * as path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const agentsFile = path.join(rootDir, 'AGENTS.md');
const modulesDir = path.join(rootDir, 'app', 'src');

const MODULE_MAP_PATTERN = /### Module map\n+```\n(?<body>[\s\S]*?)```/;
const MODULE_ENTRY_PATTERN = /^ {2}(?<name>[a-z-]+)\/(?: |$)/;

const source = fs.readFileSync(agentsFile, 'utf8');
const body = MODULE_MAP_PATTERN.exec(source)?.groups?.body;

if (body === undefined) {
  process.stderr.write('AGENTS.md: no fenced module map found under "### Module map"\n');
  process.exit(1);
}

const documented = new Set(
  body
    .split('\n')
    .map((line) => MODULE_ENTRY_PATTERN.exec(line)?.groups?.name)
    .filter((name) => name !== undefined)
);

const present = new Set(
  fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
);

const undocumented = [...present].filter((name) => !documented.has(name)).sort();
const stale = [...documented].filter((name) => !present.has(name)).sort();

if (undocumented.length === 0 && stale.length === 0) {
  process.exit(0);
}

if (undocumented.length > 0) {
  process.stderr.write(`AGENTS.md module map does not document: ${undocumented.join(', ')}\n`);
}
if (stale.length > 0) {
  process.stderr.write(`AGENTS.md module map documents directories that do not exist: ${stale.join(', ')}\n`);
}

process.exit(1);
