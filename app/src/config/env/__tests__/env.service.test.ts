import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvService } from '../env.service.ts';

import type { $Env } from '../env.schemas.ts';

/** the raw strings the process is handed, before `$Env` coerces them */
const mockEnv: Omit<{ [K in keyof $Env]: string }, 'APP_PUBLIC_URL'> = {
  APP_HOST: '0.0.0.0',
  APP_PORT: '3000',
  CONFIG_PATH: '/dev/null',
  DATABASE_URL: 'file:///dev/null',
  MATTERMOST_TEAM: 'collegium',
  MATTERMOST_URL: 'http://mattermost:8065',
  WORKSPACE_ROOT: '/tmp/collegium-test-workspaces'
};

Object.entries(mockEnv).forEach(([key, value]) => {
  vi.stubEnv(key, value);
});

describe('EnvService', () => {
  let envService: EnvService;

  beforeEach(() => {
    envService = new EnvService();
  });

  describe('get', () => {
    it('should return the value from the environment', () => {
      expect(envService.get('CONFIG_PATH')).toBe(mockEnv.CONFIG_PATH);
    });

    it('should return the port as a number', () => {
      expect(envService.get('APP_PORT')).toBe(3000);
    });

    it('should derive the public URL from the bound address', () => {
      expect(envService.get('APP_PUBLIC_URL')).toBe('http://0.0.0.0:3000');
    });
  });
});
