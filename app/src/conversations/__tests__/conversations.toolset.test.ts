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
      from: undefined,
      limit: 10,
      query: 'budget',
      until: undefined
    });
    expect(result.unwrap().text).toBe('no posts matched');
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
      { authorUsername: 'casey', channelName: 'Main', createdAt: new Date(0), id: 'post-1', message: 'the budget' }
    ]);
    const result = await executeTool(search, { count: 10, query: 'budget' }, context);
    expect(result.unwrap().text).toContain('⟨post-1⟩ in Main — @casey');
    expect(result.unwrap().text).toContain('> the budget');
  });
});
