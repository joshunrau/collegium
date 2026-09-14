import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EnvService } from '@/config/env/env.service.ts';
import { createEnvServiceMock } from '@/testing/factories/env-service.factory.ts';

import { ResourcesService } from '../resources.service.ts';

describe('ResourcesService', () => {
  let resourcesRoot: string;

  const build = async (root: string | undefined) => {
    const moduleRef = await Test.createTestingModule({
      providers: [ResourcesService, { provide: EnvService, useValue: createEnvServiceMock({ RESOURCES_ROOT: root }) }]
    }).compile();
    return moduleRef.get(ResourcesService);
  };

  beforeEach(() => {
    resourcesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-resources-'));
    fs.mkdirSync(path.join(resourcesRoot, 'mail'));
    fs.writeFileSync(path.join(resourcesRoot, 'mail', 'signature.html'), '{BODY}');
  });

  afterEach(() => {
    fs.rmSync(resourcesRoot, { force: true, recursive: true });
  });

  it('reads a file beneath the root', async () => {
    expect((await build(resourcesRoot)).readText('mail/signature.html')).toBe('{BODY}');
  });

  it('refuses a resource when no root is set', async () => {
    const service = await build(undefined);
    expect(() => service.readText('mail/signature.html')).toThrow('RESOURCES_ROOT is not set');
  });

  it('refuses a symlink leading outside the root', async () => {
    const outside = path.join(os.tmpdir(), `collegium-outside-${path.basename(resourcesRoot)}.html`);
    fs.writeFileSync(outside, 'secret');
    fs.symlinkSync(outside, path.join(resourcesRoot, 'escape.html'));
    try {
      const service = await build(resourcesRoot);
      expect(() => service.readText('escape.html')).toThrow('resolves outside RESOURCES_ROOT');
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
