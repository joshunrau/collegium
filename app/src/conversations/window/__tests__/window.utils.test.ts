import { describe, expect, it } from 'vitest';

import { costOf } from '../window.utils.ts';

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
