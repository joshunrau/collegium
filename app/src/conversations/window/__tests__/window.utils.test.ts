import { describe, expect, it } from 'vitest';

import { costOf, replayLineOf } from '../window.utils.ts';

import type { WindowEntry } from '../../conversations.types.ts';

const post = (attachments: null | PrismaJson.PostAttachments): WindowEntry => ({
  kind: 'post',
  post: {
    attachments,
    authoringTurnId: null,
    authorKind: 'human',
    authorUsername: 'casey',
    channelId: 'channel-1',
    createdAt: new Date(0),
    id: 'post-1',
    isForgotten: false,
    kind: 'message',
    message: 'what do you think?',
    observedAt: new Date(0)
  }
});

describe('costOf', () => {
  it("should cost a post's attachment lines as well as its text", () => {
    const files = [{ id: 'file-1', mimeType: 'application/pdf', name: 'q3-report.pdf', size: 421888 }];
    expect(costOf([post({ files })])).toBeGreaterThan(costOf([post(null)]));
  });
});

describe('replayLineOf', () => {
  it('should read a result as the replay line the tool declared', () => {
    const payload = {
      callId: 'c1',
      kind: 'tool_result',
      output: 'x',
      replay: '[read notes.md (12 bytes)]',
      toolName: ['workspace', 'read']
    } as const;
    expect(replayLineOf(payload)).toBe('[read notes.md (12 bytes)]');
  });

  it('should read a result that declared none as its own name (§3.8)', () => {
    const payload = { callId: 'c1', kind: 'tool_result', output: 'sent', toolName: ['mail', 'send'] } as const;
    expect(replayLineOf(payload)).toBe('[mail__send]');
  });

  it('should read nothing from an event that is not a tool result', () => {
    expect(replayLineOf({ content: 'thinking', kind: 'assistant_message', toolCalls: [] })).toBeUndefined();
  });
});
