import { describe, expect, it } from 'vitest';

import { renderAddressingPreamble } from '../addressing.preamble.ts';

describe('renderAddressingPreamble', () => {
  it('should state that a person’s @ notifies them and starts no turn, beside what a colleague’s @ does (§3.8, §4.5)', () => {
    expect(renderAddressingPreamble()).toContain(
      "its name without the @ starts nothing. A person's handle written with its @ notifies that person and starts no turn."
    );
  });
});
