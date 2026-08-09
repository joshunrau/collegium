import { describe, expect, it } from 'vitest';

import { $MattermostPostedEventMessage } from '../mattermost.schemas.ts';

describe('$MattermostPostedEventMessage', () => {
  it('should be defined', () => {
    expect($MattermostPostedEventMessage).toBeDefined();
  });
});
