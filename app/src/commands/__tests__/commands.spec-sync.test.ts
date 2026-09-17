import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { COMMAND_TRIGGERS } from '../commands.definitions.ts';

const SPECIFICATION = fs.readFileSync(path.resolve(import.meta.dirname, '../../../..', 'SPEC.md'), 'utf-8');

function readDocumentedTriggers(): ReadonlySet<string> {
  const section = SPECIFICATION.split(/^### \*\*8\.4 Command Surface\*\*/mu)[1]?.split(/^## /mu)[0] ?? '';

  return new Set(
    [...section.matchAll(/^- \*\*`\/collegium (\w[\w-]*)/gmu)]
      .map(([, trigger]) => trigger)
      .filter((trigger) => trigger !== undefined)
  );
}

describe('the command surface', () => {
  it('should be named by SPEC.md §8.4 exactly as COMMAND_TRIGGERS declares it', () => {
    const declared = new Set<string>(COMMAND_TRIGGERS);
    const documented = readDocumentedTriggers();

    expect({
      declaredButNotDocumented: [...declared].filter((trigger) => !documented.has(trigger)),
      documentedButNotDeclared: [...documented].filter((trigger) => !declared.has(trigger))
    }).toStrictEqual({ declaredButNotDocumented: [], documentedButNotDeclared: [] });
  });
});
