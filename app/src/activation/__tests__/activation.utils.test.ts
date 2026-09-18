import { describe, expect, it } from 'vitest';

import type { ActivationSource } from '@/conversations/conversations.types.ts';

import { toActivationRootPostId } from '../activation.utils.ts';

const source = (overrides: Partial<ActivationSource>): ActivationSource => ({
  authorKind: 'agent',
  authorUsername: 'owen',
  delegator: undefined,
  parentChainLength: 2,
  parentDepth: 1,
  parentRootPostId: 'post-root',
  ...overrides
});

describe('toActivationRootPostId (§7.4)', () => {
  it('should root a human-initiated and a trigger-initiated turn at its own triggering post', () => {
    expect(toActivationRootPostId(source({ authorKind: 'human' }), 'post-1')).toBe('post-1');
    expect(toActivationRootPostId(source({ authorKind: 'system' }), 'post-1')).toBe('post-1');
    expect(toActivationRootPostId(undefined, 'post-1')).toBe('post-1');
  });

  it('should carry the parent root through a hand-off and a return alike', () => {
    expect(toActivationRootPostId(source({}), 'post-9')).toBe('post-root');
    expect(toActivationRootPostId(source({ delegator: { agentUsername: 'mira', depth: 0 } }), 'post-9')).toBe(
      'post-root'
    );
  });

  it('should fall back to the activating post where the parent recorded no root (§7.3)', () => {
    expect(toActivationRootPostId(source({ parentRootPostId: undefined }), 'post-9')).toBe('post-9');
  });
});
