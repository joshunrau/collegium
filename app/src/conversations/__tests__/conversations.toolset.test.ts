import { describe, expect, it } from 'vitest';

import { RosterService } from '@/channels/roster/roster.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { CONVERSATIONS_TOOLSET } from '../conversations.toolset.ts';
import { SearchService } from '../search/search.service.ts';

const { search } = CONVERSATIONS_TOOLSET.tools;

function buildContext() {
  const roster = MockFactory.createMock(RosterService);
  const searchService = MockFactory.createMock(SearchService);
  const context = { roster, search: searchService, turn: buildToolTurnScope() };
  return { context, roster, searchService };
}

describe('CONVERSATIONS_TOOLSET', () => {
  it('should search only the channels the roster allows from this one (§3.8)', async () => {
    const { context, roster, searchService } = buildContext();
    const channels = [{ channelId: 'channel-1', name: 'Main' }];
    roster.listReachableFrom.mockReturnValue(channels);
    searchService.find.mockResolvedValue([]);
    const result = await executeTool(search, { count: 10, query: 'budget' }, context);
    expect(roster.listReachableFrom).toHaveBeenCalledWith('mira', 'channel-1');
    expect(searchService.find).toHaveBeenCalledWith({
      agentUsername: 'mira',
      authorUsername: undefined,
      channels,
      excludePostIds: ['post-1'],
      from: undefined,
      limit: 10,
      query: 'budget',
      until: undefined
    });
    expect(result.unwrap().text).toContain('no posts matched "budget"');
  });

  it('should pass author and day bounds through', async () => {
    const { context, roster, searchService } = buildContext();
    roster.listReachableFrom.mockReturnValue([]);
    searchService.find.mockResolvedValue([]);
    await executeTool(
      search,
      { author: 'casey', count: 3, from: '2026-09-01', query: 'x', until: '2026-09-02' },
      context
    );
    expect(searchService.find).toHaveBeenCalledWith(
      expect.objectContaining({
        authorUsername: 'casey',
        from: new Date('2026-09-01T00:00:00.000Z'),
        limit: 3,
        until: new Date('2026-09-02T23:59:59.999Z')
      })
    );
  });

  it('should render the hits it finds', async () => {
    const { context, roster, searchService } = buildContext();
    roster.listReachableFrom.mockReturnValue([{ channelId: 'channel-1', name: 'Main' }]);
    searchService.find.mockResolvedValue([
      { authorUsername: 'casey', channelName: 'Main', createdAt: new Date(0), id: 'post-2', message: 'the budget' }
    ]);
    const result = await executeTool(search, { count: 10, query: 'budget' }, context);
    expect(result.unwrap().text).toContain('⟨post-2⟩ in Main — @casey');
    expect(result.unwrap().text).toContain('<<<post post-2\nthe budget\n>>>');
  });

  it('should not return the post that triggered this turn (§3.8)', async () => {
    const { context, roster, searchService } = buildContext();
    roster.listReachableFrom.mockReturnValue([]);
    searchService.find.mockResolvedValue([]);
    await executeTool(search, { count: 10, query: 'budget' }, context);
    expect(searchService.find).toHaveBeenCalledWith(expect.objectContaining({ excludePostIds: ['post-1'] }));
  });

  it('should read one post whole by its id, through the reach a search has (§3.8)', async () => {
    const { context, roster, searchService } = buildContext();
    const channels = [{ channelId: 'channel-1', name: 'Main' }];
    roster.listReachableFrom.mockReturnValue(channels);
    searchService.findById.mockResolvedValue({
      authorUsername: 'casey',
      channelName: 'Main',
      createdAt: new Date(0),
      id: 'post-7',
      message: 'the whole budget'
    });
    const result = await executeTool(search, { count: 10, postId: 'post-7' }, context);
    expect(searchService.findById).toHaveBeenCalledWith({ agentUsername: 'mira', channels, postId: 'post-7' });
    expect(searchService.find).not.toHaveBeenCalled();
    expect(result.unwrap().text).toContain('<<<post post-7\nthe whole budget\n>>>');
  });

  it('should reject a call giving both a query and a postId', () => {
    expect(search.parameters.safeParse({ postId: 'post-7', query: 'budget' }).success).toBe(false);
    expect(search.parameters.safeParse({}).success).toBe(false);
  });

  it('should mark a search that matched nothing (§8.1)', async () => {
    const { context, roster, searchService } = buildContext();
    roster.listReachableFrom.mockReturnValue([]);
    searchService.find.mockResolvedValue([]);
    const empty = await executeTool(search, { count: 10, query: 'budget' }, context);
    expect(empty.unwrap().traceOutcome).toBe('⚠️ no matches');
  });

  it('should name active filters in the trace (§8.1)', () => {
    expect(search.traceDetail?.({ count: 10, query: 'budget' })).toBe('"budget"');
    expect(search.traceDetail?.({ author: 'casey', count: 10, from: '2026-01-01', query: 'budget' })).toBe(
      '"budget" (author casey, 2026-01-01..…)'
    );
    expect(search.traceDetail?.({ count: 10, postId: 'post-7' })).toBe('post post-7');
  });
});
