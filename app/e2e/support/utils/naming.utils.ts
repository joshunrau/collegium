import { randomInt } from 'node:crypto';

import { E2E_RESOURCE_PREFIX } from '../constants.ts';

const DIGITS = '0123456789';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const MATTERMOST_USERNAME_MAX_LENGTH = 22;
const WORKSPACE_ID_LENGTH = 6;

export function createWorkspaceId(): string {
  const alphabet = LETTERS + DIGITS;
  const tail = Array.from({ length: WORKSPACE_ID_LENGTH - 1 }, () => alphabet[randomInt(alphabet.length)]);
  return [LETTERS[randomInt(LETTERS.length)], ...tail].join('');
}

export function toBotUsername(workspaceId: string, name: string): string {
  const username = `${workspaceId}-${name}`;
  if (username.length > MATTERMOST_USERNAME_MAX_LENGTH) {
    throw new Error(
      `bot username "${username}" exceeds Mattermost's ${MATTERMOST_USERNAME_MAX_LENGTH} character limit — shorten the agent name to at most ${MATTERMOST_USERNAME_MAX_LENGTH - WORKSPACE_ID_LENGTH - 1} characters`
    );
  }
  return username;
}

export function toChannelName(workspaceId: string, name: string): string {
  return `${E2E_RESOURCE_PREFIX}-${workspaceId}-${name}`;
}
