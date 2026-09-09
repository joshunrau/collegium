/**
 * Cross-compiles the server binary for every platform a Mattermost server may run on, and packs
 * the bundle Mattermost installs. The version is the root's: the plugin ships with the framework,
 * and provisioning re-installs it exactly when that version moves.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { BUNDLE_DIR, MATTERMOST_PLUGIN_ID } from '@collegium/mattermost';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');
const SERVER_DIR = path.join(PACKAGE_DIR, 'src', 'server');
const DIST_DIR = path.dirname(BUNDLE_DIR);

const PLATFORMS = [
  { arch: 'amd64', os: 'linux' },
  { arch: 'arm64', os: 'linux' }
] as const;

const { version } = JSON.parse(fs.readFileSync(path.resolve(PACKAGE_DIR, '..', '..', 'package.json'), 'utf-8')) as {
  version: string;
};

fs.mkdirSync(path.join(BUNDLE_DIR, 'server', 'dist'), { recursive: true });

const executables: { [platform: string]: string } = {};
for (const { arch, os } of PLATFORMS) {
  const executable = `server/dist/plugin-${os}-${arch}`;
  execFileSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', path.join(BUNDLE_DIR, executable), '.'], {
    cwd: SERVER_DIR,
    env: { ...process.env, CGO_ENABLED: '0', GOARCH: arch, GOOS: os },
    stdio: 'inherit'
  });
  executables[`${os}-${arch}`] = executable;
}

fs.writeFileSync(
  path.join(BUNDLE_DIR, 'plugin.json'),
  JSON.stringify(
    {
      description: 'The /collegium slash command, forwarded to the Collegium app that declared it for the team.',
      homepage_url: 'https://collegium.sh',
      id: MATTERMOST_PLUGIN_ID,
      min_server_version: '9.0.0',
      name: 'Collegium',
      server: { executables },
      version
    },
    null,
    2
  )
);

execFileSync(
  'tar',
  ['--no-xattrs', '-czf', path.join(DIST_DIR, `${MATTERMOST_PLUGIN_ID}.tar.gz`), '-C', DIST_DIR, MATTERMOST_PLUGIN_ID],
  { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: 'inherit' }
);
process.stdout.write(
  `built ${MATTERMOST_PLUGIN_ID}@${version} for ${PLATFORMS.map(({ arch, os }) => `${os}-${arch}`).join(', ')}\n`
);
