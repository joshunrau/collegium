import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeRetainedWorkspaceFile } from '../workspace.utils.ts';

describe('writeRetainedWorkspaceFile', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-retained-')), 'workspace');
  });

  afterEach(() => {
    fs.rmSync(path.dirname(workspaceDir), { force: true, recursive: true });
  });

  it('should write the file and keep only the newest by name', async () => {
    for (const name of ['1.txt', '2.txt', '3.txt']) {
      const written = await writeRetainedWorkspaceFile(workspaceDir, {
        content: name,
        directory: 'out',
        name,
        retain: 2
      });
      expect(written).toBe(path.join('out', name));
    }
    expect(fs.readdirSync(path.join(workspaceDir, 'out')).sort()).toStrictEqual(['2.txt', '3.txt']);
    expect(fs.readFileSync(path.join(workspaceDir, 'out', '3.txt'), 'utf8')).toBe('3.txt');
  });
});
