import { describe, expect, it } from 'vitest';

import { parseClearArguments } from '../clear.utils.ts';

describe('parseClearArguments', () => {
  it('should read a bare command as posts only', () => {
    expect(parseClearArguments('')).toStrictEqual({ memories: false });
    expect(parseClearArguments('   ')).toStrictEqual({ memories: false });
  });

  it('should read the memories flag', () => {
    expect(parseClearArguments(' --memories ')).toStrictEqual({ memories: true });
  });

  it('should refuse any other token', () => {
    expect(parseClearArguments('memories')).toBeUndefined();
    expect(parseClearArguments('--memories --files')).toBeUndefined();
  });
});
