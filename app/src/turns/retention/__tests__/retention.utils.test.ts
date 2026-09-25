import { describe, expect, it } from 'vitest';

import { planRelief, planView, viewCapCharsFor } from '../retention.utils.ts';

describe('viewCapCharsFor (§3.8)', () => {
  it('should give a result 15% of the ceiling, never more than 30,000 tokens, in characters', () => {
    expect(viewCapCharsFor({ turnContextCeilingTokens: 200_000 })).toBe(120_000);
    expect(viewCapCharsFor({ turnContextCeilingTokens: 100_000 })).toBe(60_000);
    expect(viewCapCharsFor({ turnContextCeilingTokens: 1_000_000 })).toBe(120_000);
  });
});

describe('planRelief (§3.8)', () => {
  it('should collapse nothing while the prompt is at or under the ceiling', () => {
    const candidates = [{ key: 1, savedTokens: 500 }];
    expect(planRelief({ candidates, ceilingTokens: 1_000, promptTokens: 1_000 })).toStrictEqual([]);
  });

  it('should collapse the largest first, ties to the oldest, until the prompt is at the low-water mark', () => {
    const candidates = [
      { key: 1, savedTokens: 100 },
      { key: 2, savedTokens: 300 },
      { key: 3, savedTokens: 300 },
      { key: 4, savedTokens: 50 }
    ];
    expect(planRelief({ candidates, ceilingTokens: 1_000, promptTokens: 1_100 })).toStrictEqual([2, 3]);
  });

  it('should collapse every candidate when even all of them do not reach the low-water mark', () => {
    const candidates = [
      { key: 1, savedTokens: 10 },
      { key: 2, savedTokens: 20 }
    ];
    expect(planRelief({ candidates, ceilingTokens: 1_000, promptTokens: 2_000 })).toStrictEqual([2, 1]);
  });
});

describe('planView (§3.8)', () => {
  it('should shorten the longest views to one level, no lower than needed', () => {
    const plan = planView({
      candidates: [
        { key: 1, shownChars: 10_000 },
        { key: 2, shownChars: 6_000 },
        { key: 3, shownChars: 3_000 }
      ],
      excessTokens: 1_500,
      floorChars: 2_000
    });
    expect(plan).toStrictEqual({
      shownChars: new Map([
        [1, 5_000],
        [2, 5_000]
      ]),
      standIns: []
    });
  });

  it('should shorten every view to the floor, then replace the newest with its stand-in, where the floors do not fit', () => {
    const plan = planView({
      candidates: [
        { key: 1, shownChars: 5_000 },
        { key: 2, shownChars: 5_000 }
      ],
      excessTokens: 2_000,
      floorChars: 2_000
    });
    expect(plan).toStrictEqual({ shownChars: new Map([[1, 2_000]]), standIns: [2] });
  });
});
