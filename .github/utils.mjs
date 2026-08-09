/// <reference types="node" />

// @ts-check

import * as fs from 'node:fs';
import * as path from 'node:path';

const GITHUB_WORKSPACE = process.env.GITHUB_WORKSPACE;
if (!GITHUB_WORKSPACE) {
  throw new Error("Missing required environment variable 'GITHUB_WORKSPACE'");
}

const PACKAGE_JSON_PATH = path.join(GITHUB_WORKSPACE, 'package.json');
const OWNER = 'joshunrau';
const PACKAGE_NAMES = ['collegium'];
const VERSION_TAG_REGEX = /^\d+\.\d+\.\d+(-(?:alpha|beta)\.\d+)?$/;

/**
 * Extracts a semantic version string from a list of container image tags.
 * @param {string[]} tags
 * @returns {string | null}
 */
function extractVersionFromTags(tags) {
  for (const tag of tags) {
    if (VERSION_TAG_REGEX.test(tag)) {
      return tag;
    }
  }
  return null;
}

/**
 * Compares two version strings to see if the current one is newer.
 * Throws an error if the latest published version is greater.
 * @param {string} current
 * @param {string} latest
 * @returns {boolean}
 */
function isNewerVersion(current, latest) {
  const [currentMain, currentTag = ''] = current.split('-');
  const [latestMain, latestTag = ''] = latest.split('-');

  const currentParts = currentMain.split('.').map(Number);
  const latestParts = latestMain.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (currentParts[i] > latestParts[i]) {
      return true;
    }
    if (currentParts[i] < latestParts[i]) {
      throw new Error(`Latest published version '${latest}' is greater than current version '${current}'`);
    }
  }

  /** @type {(tag: string) => number} */
  const rank = (tag) => {
    if (tag.startsWith('alpha')) {
      return 0;
    }
    if (tag.startsWith('beta')) {
      return 1;
    }
    return 2;
  };

  const currentRank = rank(currentTag);
  const latestRank = rank(latestTag);

  if (currentRank > latestRank) {
    return true;
  }

  if (latestRank > currentRank) {
    throw new Error(`Latest published version '${latest}' is greater than current version '${current}'`);
  }

  const currentSuffix = Number(currentTag.split('.')[1] || 0);
  const latestSuffix = Number(latestTag.split('.')[1] || 0);

  if (currentSuffix > latestSuffix) {
    return true;
  } else if (latestSuffix > currentSuffix) {
    throw new Error(`Latest published version '${latest}' is greater than current version '${current}'`);
  }

  return false;
}

/**
 * Fetches and returns the single latest published version from the GitHub Container Registry.
 * @param {{ github: any }} arg
 * @returns {Promise<string | null | undefined>}
 */
async function getLatestPublishedVersion({ github }) {
  const versionPromises = PACKAGE_NAMES.map(async (packageName) => {
    /** @type {{ metadata: { container: { tags: string[] } } }[]} */
    let versions;
    try {
      /** @type {{ data: { metadata: { container: { tags: string[]; } } }[] }} */
      const response = await github.rest.packages.getAllPackageVersionsForPackageOwnedByUser({
        package_name: packageName,
        package_type: 'container',
        username: OWNER
      });
      versions = response.data;
    } catch (err) {
      // the package does not exist until the first image is pushed
      if (/** @type {{ status?: number }} */ (err).status === 404) {
        return null;
      }
      throw err;
    }
    const latestVersionPackage = versions.find(({ metadata }) => metadata?.container?.tags.includes('latest'));
    if (!latestVersionPackage) {
      return null;
    }
    return extractVersionFromTags(latestVersionPackage.metadata.container.tags);
  });
  const resolvedVersions = (await Promise.all(versionPromises)).filter(Boolean);
  if (resolvedVersions.length === 0) {
    return null;
  }
  const uniqueVersions = new Set(resolvedVersions);
  if (uniqueVersions.size > 1) {
    throw new Error(`Conflicting 'latest' versions found: ${Array.from(uniqueVersions).join(', ')}`);
  }
  return uniqueVersions.values().next().value;
}

/**
 * Determines if a release is needed by comparing the package.json version
 * with the latest published version in the container registry.
 * @param {{ github: any }} arg
 * @returns {Promise<string | null>} The new version string if a release is needed, otherwise null.
 */
export async function determineReleaseVersion({ github }) {
  const { version: currentVersion } = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
  const latestPublishedVersion = await getLatestPublishedVersion({ github });

  if (!latestPublishedVersion) {
    return currentVersion;
  }

  if (isNewerVersion(currentVersion, latestPublishedVersion)) {
    return currentVersion;
  }

  return null;
}
