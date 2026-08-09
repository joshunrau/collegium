import { Injectable } from '@nestjs/common';

import { $Env } from './env.schemas.ts';

@Injectable()
export class EnvService {
  private readonly env: $Env;

  constructor() {
    this.env = $Env.parse(process.env);
  }

  get<TKey extends Extract<keyof $Env, string>>(key: TKey): $Env[TKey] {
    return this.env[key];
  }
}
