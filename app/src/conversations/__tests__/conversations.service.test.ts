import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthorKind, PostKind } from '@/prisma/prisma.types.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';
import { createObservedPost as post } from '@/testing/factories/observed-post.factory.ts';

import { ConversationsService } from '../conversations.service.ts';

type PostRow = {
  attachments: null | PrismaJson.PostAttachments;
  authoringTurnId: null | string;
  authorKind: AuthorKind;
  authorUsername: string;
  channelId: string;
  createdAt: Date;
  id: string;
  isForgotten: boolean;
  kind: PostKind;
  message: string;
  observedAt: Date;
};

const AUTHORING_TURN_DEPTH = 3;

/** turn-1 was activated by post-0, which turn-0 (mira's) authored — the §7.4 lineage a return is read from */
const TURNS = {
  'turn-0': {
    agentUsername: 'mira',
    chainLength: 1,
    channelId: 'channel-1',
    depth: 0,
    id: 'turn-0',
    rootPostId: 'post-root',
    triggeringPostId: null
  },
  'turn-1': {
    agentUsername: 'owen',
    chainLength: 2,
    channelId: 'channel-1',
    depth: AUTHORING_TURN_DEPTH,
    id: 'turn-1',
    rootPostId: 'post-root',
    triggeringPostId: 'post-0'
  }
} as const;

/** the delegate is faked with real state because idempotency is only observable against real state */
const createPostTable = () => {
  return createModelTable<PostRow>({
    defaults: (sequence) => ({
      attachments: null,
      authoringTurnId: null,
      isForgotten: false,
      kind: 'message',
      observedAt: new Date(sequence)
    }),
    relations: {
      authoringTurn: (row) => {
        return row.authoringTurnId === null ? undefined : TURNS[row.authoringTurnId as keyof typeof TURNS];
      }
    },
    uniqueFields: ['id']
  });
};

describe('ConversationsService', () => {
  let conversationsService: ConversationsService;
  let table: ReturnType<typeof createPostTable>;

  beforeEach(async () => {
    table = createPostTable();
    const moduleRef = await Test.createTestingModule({
      providers: [ConversationsService, { provide: getModelToken('Post'), useValue: table }]
    }).compile();
    conversationsService = moduleRef.get(ConversationsService);
  });

  describe('record', () => {
    it('should produce one row for a post seen twice, reporting which call inserted it', async () => {
      expect(await conversationsService.record(post())).toBe(true);
      expect(await conversationsService.record(post())).toBe(false);
      expect(table.rows).toHaveLength(1);
    });

    it('should record an observed post as a message and an authored one under its kind', async () => {
      await conversationsService.record(post());
      await conversationsService.record(post({ id: 'post-2' }), { kind: 'status', turnId: 'turn-1' });
      expect(table.rows.map((row) => row.kind)).toStrictEqual(['message', 'status']);
    });

    it('should stamp the authoring turn and kind onto a row another socket recorded first', async () => {
      await conversationsService.record(post());
      await conversationsService.record(post(), { kind: 'reply', turnId: 'turn-1' });
      expect(table.rows[0]).toMatchObject({ authoringTurnId: 'turn-1', kind: 'reply' });
    });

    it('should record the files a post carried', async () => {
      const file = { id: 'file-1', mimeType: 'application/pdf', name: 'q3-report.pdf', size: 421888 };
      await conversationsService.record(post({ attachments: [file] }));
      expect(table.rows[0]?.attachments).toStrictEqual({ files: [file] });
    });

    it('should leave the column null for a post with no files', async () => {
      await conversationsService.record(post());
      expect(table.rows[0]?.attachments).toBeNull();
    });

    it('should rethrow a write failure that is not a duplicate', async () => {
      vi.spyOn(table, 'create').mockRejectedValue(new Error('database is locked'));
      await expect(conversationsService.record(post())).rejects.toThrow('database is locked');
    });
  });

  describe('findActivationSource', () => {
    it('should report the author beside the depth, chain length and root of the turn that authored the post', async () => {
      await conversationsService.record(post({ authorKind: 'agent', authorUsername: 'owen' }), {
        kind: 'reply',
        turnId: 'turn-1'
      });
      expect(await conversationsService.findActivationSource('post-1')).toStrictEqual({
        authorKind: 'agent',
        authorUsername: 'owen',
        delegator: undefined,
        parentChainLength: 2,
        parentDepth: AUTHORING_TURN_DEPTH,
        parentRootPostId: 'post-root'
      });
    });

    it('should name the turn the authoring turn was answering, read through its triggering post', async () => {
      await conversationsService.record(post({ authorKind: 'agent', authorUsername: 'mira', id: 'post-0' }), {
        kind: 'reply',
        turnId: 'turn-0'
      });
      await conversationsService.record(post({ authorKind: 'agent', authorUsername: 'owen' }), {
        kind: 'reply',
        turnId: 'turn-1'
      });
      expect(await conversationsService.findActivationSource('post-1')).toMatchObject({
        delegator: { agentUsername: 'mira', depth: 0 }
      });
    });

    it('should report no lineage for a post no turn of this process authored', async () => {
      await conversationsService.record(post());
      expect(await conversationsService.findActivationSource('post-1')).toStrictEqual({
        authorKind: 'human',
        authorUsername: 'casey',
        delegator: undefined,
        parentChainLength: undefined,
        parentDepth: undefined,
        parentRootPostId: undefined
      });
    });

    it('should return undefined for a post the store never recorded', async () => {
      expect(await conversationsService.findActivationSource('post-9')).toBeUndefined();
    });
  });

  describe('findRequester', () => {
    it('should name a colleague beside the person its chain descends from, read off the root post (§3.7, §7.4)', async () => {
      await conversationsService.record(
        post({ authorKind: 'human', authorUsername: 'casey', id: 'post-root', message: 'owen, ask mira' })
      );
      await conversationsService.record(post({ authorKind: 'agent', authorUsername: 'owen' }), {
        kind: 'reply',
        turnId: 'turn-1'
      });
      expect(await conversationsService.findRequester('post-1')).toStrictEqual({
        kind: 'agent',
        onBehalfOf: { kind: 'human', message: 'owen, ask mira', username: 'casey' },
        username: 'owen'
      });
    });

    it('should name a colleague alone when its chain root is not stored', async () => {
      await conversationsService.record(post({ authorKind: 'agent', authorUsername: 'owen' }), {
        kind: 'reply',
        turnId: 'turn-1'
      });
      expect(await conversationsService.findRequester('post-1')).toStrictEqual({
        kind: 'agent',
        onBehalfOf: undefined,
        username: 'owen'
      });
    });

    it("should quote a person's own post and mark the system bot's as a trigger", async () => {
      await conversationsService.record(post({ message: 'ship it' }));
      await conversationsService.record(post({ authorKind: 'system', authorUsername: 'orchestrator', id: 'post-2' }));
      expect(await conversationsService.findRequester('post-1')).toStrictEqual({
        kind: 'human',
        message: 'ship it',
        username: 'casey'
      });
      expect(await conversationsService.findRequester('post-2')).toStrictEqual({ kind: 'system' });
      expect(await conversationsService.findRequester('post-9')).toBeUndefined();
    });
  });

  describe('findAuthoringTurn', () => {
    it('should resolve a post to the row of the turn that authored it', async () => {
      await conversationsService.record(post(), { kind: 'reply', turnId: 'turn-1' });
      expect(await conversationsService.findAuthoringTurn('post-1')).toMatchObject({
        channelId: 'channel-1',
        id: 'turn-1'
      });
    });

    it('should return undefined for an unrecorded post and for one no turn authored', async () => {
      await conversationsService.record(post());
      expect(await conversationsService.findAuthoringTurn('post-1')).toBeUndefined();
      expect(await conversationsService.findAuthoringTurn('post-9')).toBeUndefined();
    });
  });

  describe('findAuthoredMessage', () => {
    it('should return the stored text of a post, and undefined for one it never recorded', async () => {
      await conversationsService.record(post({ id: 'post-1', message: 'the trace so far' }));
      expect(await conversationsService.findAuthoredMessage('post-1')).toBe('the trace so far');
      expect(await conversationsService.findAuthoredMessage('post-9')).toBeUndefined();
    });
  });

  describe('hasPostsObservedSince', () => {
    const since = { agentUsername: 'mira', channelId: 'channel-1', since: new Date(1) };

    it("should count nothing but others' posts observed at or after the instant (§5.2)", async () => {
      await conversationsService.record(post({ id: 'post-0' }));
      await conversationsService.record(post({ authorKind: 'agent', authorUsername: 'mira', id: 'post-1' }));
      await conversationsService.record(post({ authorKind: 'system', authorUsername: 'collegium', id: 'post-2' }));
      await conversationsService.record(post({ authorKind: 'agent', authorUsername: 'owen', id: 'post-3' }), {
        kind: 'status',
        turnId: 'turn-1'
      });
      expect(await conversationsService.hasPostsObservedSince(since)).toBe(false);
      await conversationsService.record(post({ id: 'post-4' }));
      expect(await conversationsService.hasPostsObservedSince(since)).toBe(true);
    });
  });

  describe('latestPostIdIn', () => {
    it('should return the newest recorded post id for the channel', async () => {
      await conversationsService.record(post({ createdAt: new Date(1000), id: 'post-1' }));
      await conversationsService.record(post({ createdAt: new Date(2000), id: 'post-2' }));
      expect(await conversationsService.latestPostIdIn('channel-1')).toBe('post-2');
    });

    it('should return undefined for a channel with no recorded posts', async () => {
      expect(await conversationsService.latestPostIdIn('channel-9')).toBeUndefined();
    });
  });

  describe('listAuthoredBy', () => {
    it("should list one turn's posts earliest first, leaving out its status post and every other turn's (§7.3)", async () => {
      await conversationsService.record(post({ createdAt: new Date(2000), id: 'post-2' }), {
        kind: 'reply',
        turnId: 'turn-1'
      });
      await conversationsService.record(post({ createdAt: new Date(1000), id: 'post-1' }), {
        kind: 'notice',
        turnId: 'turn-1'
      });
      await conversationsService.record(post({ id: 'post-3' }), { kind: 'status', turnId: 'turn-1' });
      await conversationsService.record(post({ id: 'post-4' }), { kind: 'reply', turnId: 'turn-0' });
      const listed = await conversationsService.listAuthoredBy('turn-1');
      expect(listed.map(({ id }) => id)).toStrictEqual(['post-1', 'post-2']);
    });
  });

  describe('summarizeBacklog', () => {
    it('should return the pointer post beside the count of live posts from it forward', async () => {
      await conversationsService.record(post({ createdAt: new Date(1000), id: 'post-1', message: 'older' }));
      await conversationsService.record(post({ createdAt: new Date(2000), id: 'post-2', message: 'pointer' }));
      await conversationsService.record(post({ createdAt: new Date(3000), id: 'post-3', message: 'newer' }));
      expect(await conversationsService.summarizeBacklog('channel-1', 'post-2')).toStrictEqual({
        message: 'pointer',
        pendingCount: 2
      });
    });

    it('should return undefined when the pointer post is not recorded', async () => {
      expect(await conversationsService.summarizeBacklog('channel-1', 'post-9')).toBeUndefined();
    });
  });

  describe('updateAuthoredMessage', () => {
    it('should replace the stored copy of a post edited in place', async () => {
      await conversationsService.record(post({ message: 'thinking…' }));
      await conversationsService.updateAuthoredMessage('post-1', 'done');
      expect(table.rows[0]?.message).toBe('done');
    });
  });

  describe('earliestOf', () => {
    it('should name the post the channel saw first among those given, ignoring unknown ids', async () => {
      await conversationsService.record(post({ createdAt: new Date(2000), id: 'post-later' }));
      await conversationsService.record(post({ createdAt: new Date(1000), id: 'post-earlier' }));
      expect(await conversationsService.earliestOf(['post-later', 'post-missing', 'post-earlier'])).toBe(
        'post-earlier'
      );
      expect(await conversationsService.earliestOf(['post-missing'])).toBeUndefined();
    });
  });
});
