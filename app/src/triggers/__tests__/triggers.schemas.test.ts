import { describe, expect, it } from 'vitest';

import { $TriggerIntakeBody } from '../triggers.schemas.ts';

const intake = { reference: {}, targetAgentUsername: 'mira', targetChannelId: 'channel-1' };

describe('$TriggerIntakeBody', () => {
  it('should accept a reference carrying a body', () => {
    expect($TriggerIntakeBody.safeParse({ ...intake, reference: { body: 'the message' } }).success).toBe(true);
  });

  // the renderer trims it, so a non-string used to strand the row after its claim and wedge the channel
  it('should reject a non-string body rather than passing it through', () => {
    expect($TriggerIntakeBody.safeParse({ ...intake, reference: { body: null } }).success).toBe(false);
  });

  it('should still pass through context keys it does not name', () => {
    const parsed = $TriggerIntakeBody.parse({ ...intake, reference: { id: 'evt-1', priority: 'high' } });
    expect(parsed.reference).toMatchObject({ id: 'evt-1', priority: 'high' });
  });
});
