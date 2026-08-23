import { describe, expect, it } from 'vitest';

import { renderToolDisplayName, renderToolWireName, TOOL_SEGMENT_PATTERN } from '../tools.naming.ts';

describe('TOOL_SEGMENT_PATTERN', () => {
  it('accepts lowercase snake_case with single underscores', () => {
    expect(TOOL_SEGMENT_PATTERN.test('mail')).toBe(true);
    expect(TOOL_SEGMENT_PATTERN.test('load_skill_v2')).toBe(true);
  });

  it('rejects doubled underscores, leading digits, and other casings', () => {
    expect(TOOL_SEGMENT_PATTERN.test('mail__send')).toBe(false);
    expect(TOOL_SEGMENT_PATTERN.test('_mail')).toBe(false);
    expect(TOOL_SEGMENT_PATTERN.test('2mail')).toBe(false);
    expect(TOOL_SEGMENT_PATTERN.test('Mail')).toBe(false);
    expect(TOOL_SEGMENT_PATTERN.test('mail-send')).toBe(false);
    expect(TOOL_SEGMENT_PATTERN.test('')).toBe(false);
  });
});

describe('rendering', () => {
  it('joins the display form with :: and the wire form with __', () => {
    expect(renderToolDisplayName(['mail', 'send'])).toBe('mail::send');
    expect(renderToolWireName(['mail', 'send'])).toBe('mail__send');
  });
});
