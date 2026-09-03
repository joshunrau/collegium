import { describe, expect, it } from 'vitest';

import type { RegisteredSlashCommand, SlashCommandRegistration } from '@/chat/chat.types.ts';

import { planSlashCommandReconciliation } from '../command-reconciler.utils.ts';

const OWN_USER_ID = 'system-bot';
const CALLBACK_URL = 'https://collegium.example.com/commands';

const desired = (overrides: Partial<SlashCommandRegistration> = {}): SlashCommandRegistration => ({
  autoCompleteHint: '',
  description: 'Abort current turns in this channel at the next boundary',
  displayName: 'stop',
  trigger: 'stop',
  url: CALLBACK_URL,
  ...overrides
});

const held = (overrides: Partial<RegisteredSlashCommand> = {}): RegisteredSlashCommand => ({
  autoComplete: true,
  autoCompleteHint: '',
  creatorId: OWN_USER_ID,
  creatorUsername: 'collegium',
  description: 'Abort current turns in this channel at the next boundary',
  displayName: 'stop',
  id: 'cmd-stop',
  method: 'P',
  trigger: 'stop',
  url: CALLBACK_URL,
  ...overrides
});

const plan = (commands: readonly RegisteredSlashCommand[], registrations: readonly SlashCommandRegistration[] = []) => {
  return planSlashCommandReconciliation({ desired: registrations, surface: { commands, ownUserId: OWN_USER_ID } });
};

describe('planSlashCommandReconciliation', () => {
  it('should create a desired trigger no command holds', () => {
    const result = plan([], [desired()]);
    expect(result.creates).toStrictEqual([desired()]);
    expect(result).toMatchObject({ collisions: [], corrections: [], deletes: [] });
  });

  it('should leave an owned command matching its registration untouched', () => {
    expect(plan([held()], [desired()])).toStrictEqual({
      collisions: [],
      corrections: [],
      creates: [],
      deletes: []
    });
  });

  it.each([
    { autoComplete: false },
    { autoCompleteHint: '{post-id}' },
    { description: 'stale purpose' },
    { displayName: 'Stop' },
    { method: 'G' },
    { url: 'https://old-host.example.com/commands' }
  ])('should correct an owned command whose %o drifted', (drift) => {
    const result = plan([held(drift)], [desired()]);
    expect(result.corrections).toStrictEqual([{ commandId: 'cmd-stop', registration: desired() }]);
    expect(result.creates).toStrictEqual([]);
  });

  it('should delete an owned command whose trigger left the desired list', () => {
    const retired = held({ id: 'cmd-warp', trigger: 'warp' });
    const result = plan([retired], [desired()]);
    expect(result.deletes).toStrictEqual([retired]);
    expect(result.corrections).toStrictEqual([]);
    expect(result.creates).toStrictEqual([desired()]);
  });

  it('should report a desired trigger held by another account as a collision', () => {
    const foreign = held({ creatorId: 'other-bot', creatorUsername: 'jira', url: 'https://jira.example.com/hook' });
    const result = plan([foreign], [desired()]);
    expect(result.collisions).toStrictEqual([foreign]);
    expect(result).toMatchObject({ corrections: [], creates: [], deletes: [] });
  });

  it('should never touch a foreign command whose trigger is not desired', () => {
    const foreign = held({ creatorId: 'other-bot', id: 'cmd-jira', trigger: 'jira' });
    expect(plan([foreign], [desired()])).toMatchObject({ collisions: [], corrections: [], deletes: [] });
  });
});
