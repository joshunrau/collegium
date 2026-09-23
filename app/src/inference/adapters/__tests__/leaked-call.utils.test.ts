import { describe, expect, it } from 'vitest';

import { containsLeakedCall } from '../leaked-call.utils.ts';

describe('containsLeakedCall (§4.5)', () => {
  it('should recognise DeepSeek’s DSML and invoke closers anywhere in the text', () => {
    expect(containsLeakedCall('</parameter>\n</invoke></｜DSML｜parameter>')).toBe(true);
    expect(containsLeakedCall('Checking now.\n<｜DSML｜invoke name="web__fetch">')).toBe(true);
  });

  it('should recognise a tool-call wrapper and a bare call object a provider failed to structure', () => {
    expect(containsLeakedCall('<tool_call>{"name":"shell__run","arguments":{}}</tool_call>')).toBe(true);
    expect(containsLeakedCall('\n{"name":"shell__run","arguments":{"command":"ls"}}')).toBe(true);
  });

  it('should leave a JSON answer without arguments, and markup quoted as code, alone', () => {
    expect(containsLeakedCall('{"name":"report","rows":3}')).toBe(false);
    expect(containsLeakedCall('A call looks like this:\n```\n<tool_call>{"name":"x"}</tool_call>\n```')).toBe(false);
    expect(containsLeakedCall('The closing tag is `</invoke>`, as the docs say.')).toBe(false);
  });

  it('should leave prose that names the words without the markup alone', () => {
    expect(containsLeakedCall('I will invoke the tool with that parameter next.')).toBe(false);
    expect(containsLeakedCall('Replace <parameter> with the venue, as in <invoke …>.')).toBe(false);
  });

  it('should recognise an invoke or parameter tag by its name, without its closer', () => {
    expect(containsLeakedCall('<invoke name="web__fetch">\n<parameter name="url">https://x</parameter>')).toBe(true);
    expect(containsLeakedCall('Checking.\n<invoke name="web__fetch">')).toBe(true);
  });
});
