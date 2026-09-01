import { describe, expect, it } from 'vitest';

import { $Env, $ProvisioningEnv } from '../env.schemas.ts';

const env: Omit<{ [K in keyof $Env]: string }, 'APP_PUBLIC_URL'> = {
  APP_HOST: '127.0.0.1',
  APP_PORT: '3000',
  CONFIG_PATH: '/etc/collegium/config.json',
  DATABASE_URL: 'file:///var/lib/collegium.db',
  MATTERMOST_TEAM: 'collegium',
  MATTERMOST_URL: 'http://mattermost:8065',
  PLUGINS_ROOT: '/srv/plugins',
  WORKSPACE_ROOT: '/workspaces'
};

describe('$Env', () => {
  it('should accept the required environment', () => {
    expect($Env.safeParse(env).success).toBe(true);
  });

  it('should reject a missing bind host', () => {
    expect($Env.safeParse({ ...env, APP_HOST: undefined }).success).toBe(false);
  });

  it('should parse the port as a number', () => {
    expect($Env.parse(env).APP_PORT).toBe(3000);
  });

  it('should reject a port outside the TCP range', () => {
    expect($Env.safeParse({ ...env, APP_PORT: '70000' }).success).toBe(false);
  });

  it('should reject an empty port', () => {
    expect($Env.safeParse({ ...env, APP_PORT: '' }).success).toBe(false);
  });

  it('should derive the public URL from the bind address when it is unset', () => {
    expect($Env.parse(env).APP_PUBLIC_URL).toBe('http://127.0.0.1:3000');
  });

  it('should keep a public URL that is set', () => {
    const set = { ...env, APP_PUBLIC_URL: 'http://host.docker.internal:3000' };
    expect($Env.parse(set).APP_PUBLIC_URL).toBe('http://host.docker.internal:3000');
  });

  it('should reject a malformed public URL', () => {
    expect($Env.safeParse({ ...env, APP_PUBLIC_URL: 'collegium' }).success).toBe(false);
  });

  it('should reject a missing config path', () => {
    expect($Env.safeParse({ ...env, CONFIG_PATH: undefined }).success).toBe(false);
  });

  it('should reject an invalid database URL', () => {
    expect($Env.safeParse({ ...env, DATABASE_URL: 'collegium.db' }).success).toBe(false);
  });

  // a path the root prologue would take for a state directory and chown recursively
  it('should reject a relative file URL, which normalizes to the filesystem root', () => {
    expect($Env.safeParse({ ...env, DATABASE_URL: 'file:./dev.db' }).success).toBe(false);
    expect($Env.safeParse({ ...env, DATABASE_URL: 'file:dev.db' }).success).toBe(false);
  });

  it('should reject a file URL naming a host, which resolves to no path at all', () => {
    expect($Env.safeParse({ ...env, DATABASE_URL: 'file://data/prod.db' }).success).toBe(false);
  });

  it('should accept a single-slash absolute file URL', () => {
    expect($Env.safeParse({ ...env, DATABASE_URL: 'file:/dev/null' }).success).toBe(true);
  });

  it('should reject a missing workspace root', () => {
    expect($Env.safeParse({ ...env, WORKSPACE_ROOT: undefined }).success).toBe(false);
  });

  it('should reject a missing team', () => {
    expect($Env.safeParse({ ...env, MATTERMOST_TEAM: undefined }).success).toBe(false);
  });

  it('should reject a malformed Mattermost URL', () => {
    expect($Env.safeParse({ ...env, MATTERMOST_URL: 'mattermost:8065' }).success).toBe(false);
  });
});

describe('$ProvisioningEnv', () => {
  const admin = {
    MATTERMOST_ADMIN_EMAIL: 'admin@collegium.local',
    MATTERMOST_ADMIN_PASSWORD: 'pw',
    MATTERMOST_ADMIN_USERNAME: 'admin'
  };

  it('should resolve the administrator it may create from a password', () => {
    expect($ProvisioningEnv.parse(admin)).toStrictEqual({
      email: 'admin@collegium.local',
      kind: 'password',
      password: 'pw',
      username: 'admin'
    });
  });

  it('should resolve an administrator that already exists from a token', () => {
    expect($ProvisioningEnv.parse({ MATTERMOST_ADMIN_TOKEN: 'tok' })).toStrictEqual({ kind: 'token', token: 'tok' });
  });

  it('should read a variable left blank as one left unset', () => {
    const blank = { MATTERMOST_ADMIN_TOKEN: 'tok', ...Object.fromEntries(Object.keys(admin).map((key) => [key, ''])) };
    expect($ProvisioningEnv.parse(blank)).toStrictEqual({ kind: 'token', token: 'tok' });
  });

  it('should reject a token given alongside a password, which name two administrators', () => {
    expect($ProvisioningEnv.safeParse({ ...admin, MATTERMOST_ADMIN_TOKEN: 'tok' }).success).toBe(false);
  });

  it('should reject a partial password credential', () => {
    expect($ProvisioningEnv.safeParse({ ...admin, MATTERMOST_ADMIN_PASSWORD: undefined }).success).toBe(false);
  });

  it('should reject an environment naming no administrator at all', () => {
    expect($ProvisioningEnv.safeParse({}).success).toBe(false);
  });

  it('should reject a malformed email', () => {
    expect($ProvisioningEnv.safeParse({ ...admin, MATTERMOST_ADMIN_EMAIL: 'admin' }).success).toBe(false);
  });
});
