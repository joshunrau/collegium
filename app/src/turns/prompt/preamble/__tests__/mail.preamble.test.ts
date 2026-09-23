import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderMailPreamble } from '../mail.preamble.ts';

describe('renderMailPreamble', () => {
  it('should state the mailbox, its announcement channel and what a ref is only for an agent holding a mailbox (§3.13)', () => {
    expect(renderMailPreamble(buildStablePromptInput())).toBeUndefined();
    expect(
      renderMailPreamble(
        buildStablePromptInput({ mailbox: { address: 'mira@example.com', announcementChannelName: 'Mail Room' } })
      )
    ).toContain(
      'Your mailbox is mira@example.com, and mail arriving there is announced in Mail Room and nowhere else. A ⟨ref⟩ names one message inside that mailbox'
    );
  });
});
