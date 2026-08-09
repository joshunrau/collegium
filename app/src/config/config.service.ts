import * as fs from 'node:fs';

import { Injectable } from '@nestjs/common';
import { get } from 'es-toolkit/compat';
import type { Get, Paths } from 'type-fest';

import { $Config } from './config.schemas.ts';
import { EnvService } from './env/env.service.ts';

import type { Config } from './config.schemas.ts';

@Injectable()
export class ConfigService {
  private readonly config: Config;

  constructor(envService: EnvService) {
    this.config = this.loadConfig(envService.get('CONFIG_PATH'));
  }

  get<const TKey extends Paths<Config>>(key: TKey): Get<Config, TKey> {
    return get(this.config, key) as Get<Config, TKey>;
  }

  private loadConfig(filepath: string): Config {
    let raw: string;
    try {
      raw = fs.readFileSync(filepath, 'utf-8');
    } catch (error) {
      throw new Error(`failed to read config at "${filepath}"`, { cause: error });
    }
    try {
      return this.parseConfig(raw);
    } catch (error) {
      throw new Error(`invalid config at "${filepath}"`, { cause: error });
    }
  }

  private parseConfig(raw: string): Config {
    const { $schema, ...config } = $Config.parse(JSON.parse(raw));
    return config;
  }
}
