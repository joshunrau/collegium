import * as fs from 'node:fs';
import * as path from 'node:path';

import type { $ResourcePath } from '@collegium/core/common';
import { Injectable } from '@nestjs/common';

import { EnvService } from '@/config/env/env.service.ts';

/** the one place a file `config.json` names beneath `RESOURCES_ROOT` is read off disk; every refusal is a boot refusal */
@Injectable()
export class ResourcesService {
  private readonly resourcesRoot: string | undefined;

  constructor(envService: EnvService) {
    this.resourcesRoot = envService.get('RESOURCES_ROOT');
  }

  readText(resourcePath: $ResourcePath): string {
    if (this.resourcesRoot === undefined) {
      throw new Error(`config names the resource "${resourcePath}", but RESOURCES_ROOT is not set`);
    }
    const resolved = path.join(this.resourcesRoot, resourcePath);
    let realRoot: string;
    let realPath: string;
    try {
      realRoot = fs.realpathSync(this.resourcesRoot);
      realPath = fs.realpathSync(resolved);
    } catch {
      throw new Error(`the resource "${resourcePath}" does not exist at ${resolved}`);
    }
    if (!realPath.startsWith(realRoot + path.sep)) {
      throw new Error(`the resource "${resourcePath}" resolves outside RESOURCES_ROOT`);
    }
    try {
      return fs.readFileSync(realPath, 'utf-8');
    } catch (error) {
      throw new Error(`the resource "${resourcePath}" could not be read at ${resolved}`, { cause: error });
    }
  }
}
