import { describe, expect, it } from 'vitest';

import {
  containsToolCallTranscript,
  lacksProse,
  renderOwedReplyRejection,
  renderUnreportedUnitRejection,
  renderVerdictOwedRejection
} from '../reply-guard.utils.ts';

describe('containsToolCallTranscript', () => {
  it('should recognise the replayed call form, including a fabricated tool name', () => {
    expect(containsToolCallTranscript('[called web__navigate({"url":"http://x"})]')).toBe(true);
    expect(containsToolCallTranscript('Sure.\n[called read_memory({"id":"m1"})]')).toBe(true);
  });

  it('should leave prose that merely mentions a tool alone', () => {
    expect(containsToolCallTranscript('I called web__navigate and it worked')).toBe(false);
    expect(containsToolCallTranscript('')).toBe(false);
  });
});

describe('lacksProse (§4.5)', () => {
  it('should find no prose in markup alone, or in punctuation and symbols', () => {
    expect(lacksProse('<br>\n<hr/>')).toBe(true);
    expect(lacksProse('--- … ---')).toBe(true);
  });

  it('should read a link written in angle brackets as prose, not as markup', () => {
    expect(lacksProse('<https://example.com/report>')).toBe(false);
    expect(lacksProse('<casey@example.com>')).toBe(false);
  });

  it('should find no prose in one line repeated five times that makes up most of the reply', () => {
    expect(lacksProse(Array.from({ length: 5 }, () => '<dcp-message-id>dcp-message-id>').join('\n'))).toBe(true);
  });

  it('should find prose in a reply in any script, and in a list whose repeated line is the minority', () => {
    expect(lacksProse('完成了。')).toBe(false);
    const table = [
      '| venue | price |',
      ...Array.from({ length: 5 }, (_, index) => `| hall ${index} | TBD |`),
      '| — | — |'
    ];
    expect(lacksProse([...table, '| — | — |', '| — | — |', '| — | — |', '| — | — |'].join('\n'))).toBe(false);
  });
});

describe('renderUnreportedUnitRejection', () => {
  const unit = { creatorDisplayName: 'Mira', creatorUsername: 'mira', others: 0, reference: 'abcd1234' };

  it('should offer tasks__report only to an agent granted it, and a mention either way (§3.4)', () => {
    expect(renderUnreportedUnitRejection({ ...unit, canReport: true })).toContain('report it with tasks__report');
    const unreporting = renderUnreportedUnitRejection({ ...unit, canReport: false });
    expect(unreporting).not.toContain('tasks__report');
    expect(unreporting).toContain('mention @mira in the post');
  });

  it('should count the other units still assigned beside the one it names (§3.15)', () => {
    expect(renderUnreportedUnitRejection({ ...unit, canReport: true, others: 2 })).toContain(
      'unit abcd1234 from Mira is still assigned to you, as are 2 more units here,'
    );
  });
});

describe('renderVerdictOwedRejection', () => {
  const unit = { assigneeDisplayName: 'Owen', assigneeUsername: 'owen', others: 0, reference: 'abcd1234' };

  it('should offer a continuation and a mention only where §4.5 would let their post through (§3.15)', () => {
    const open = renderVerdictOwedRejection({ ...unit, canContinue: true, canMention: true });
    expect(open).toContain('the report on unit abcd1234 from Owen awaits your verdict');
    expect(open).toContain('close it with tasks__close; or continue its work with tasks__assign naming it in follows');
    expect(open).toContain('in a post mentioning @owen');
    const addressedElsewhere = renderVerdictOwedRejection({ ...unit, canContinue: false, canMention: false });
    expect(addressedElsewhere).toContain('close it with tasks__close.');
    expect(addressedElsewhere).not.toContain('follows');
    expect(addressedElsewhere).not.toContain('@owen');
  });
});

describe('renderOwedReplyRejection', () => {
  it('should say why an empty ending owes a reply, answering a third colleague without an @ (§3.15, §4.5)', () => {
    expect(renderOwedReplyRejection({ kind: 'steered' })).toBe(
      'output rejected: an empty reply, but this turn owes one — a person steered it; answer them'
    );
    const colleague = renderOwedReplyRejection({ addressedUsername: 'owen', displayName: 'Tess', kind: 'colleague' });
    expect(colleague).toContain("a post of Tess's is among those it answers; answer it here in text and without an @");
    expect(colleague).toContain('this turn has already addressed @owen');
  });
});
