import { describe, expect, it } from 'vitest';

import { MattermostChannelType } from '../mattermost.constants.ts';

describe('MattermostChannelType', () => {
  it('should be defined', () => {
    expect(MattermostChannelType).toBeDefined();
  });
});
