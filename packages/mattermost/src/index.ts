import * as fs from 'node:fs';
import * as path from 'node:path';

// one level beneath the package root whether this runs from src or from dist
const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');

/** the id Mattermost knows the plugin by: the bundle directory, the KV namespace, and the `/plugins/{id}` route */
export const MATTERMOST_PLUGIN_ID = 'sh.collegium';

/** the route under `/plugins/{id}` that declares a team's command surface, with `{teamId}` to fill */
export const COMMAND_SURFACE_ROUTE = '/api/v1/teams/{teamId}/commands';

export type MattermostPluginBundle = {
  /** the tar.gz Mattermost installs, holding the manifest and one server binary per platform */
  readonly bundlePath: string;
  readonly version: string;
};

export const BUNDLE_DIR = path.join(PACKAGE_DIR, 'dist', MATTERMOST_PLUGIN_ID);

/** reads the built bundle's manifest; throws when the package has not been built */
export function readMattermostPluginBundle(): MattermostPluginBundle {
  const manifestPath = path.join(BUNDLE_DIR, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`the Mattermost plugin has not been built: ${manifestPath} is missing`);
  }
  const { version } = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { version: string };
  return { bundlePath: path.join(PACKAGE_DIR, 'dist', `${MATTERMOST_PLUGIN_ID}.tar.gz`), version };
}
