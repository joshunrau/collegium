import { describe, expect, it } from 'vitest';

import { REPLAY_VERBATIM_MAX_CHARS, TOOL_SEGMENT_PATTERN } from '../tools.constants.ts';
import {
  assertToolSegment,
  assertWireNameWithinLimit,
  describeReplaySubject,
  renderDuplicateLine,
  renderReplayLine,
  renderSameContentLine,
  renderSupersededLine,
  renderToolDisplayName,
  renderToolWireName,
  replaySubjectWhenLong
} from '../tools.utils.ts';

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

describe('grammar assertions', () => {
  it('names the subject of a segment outside the grammar', () => {
    expect(() => assertToolSegment('Mail', 'toolset namespace')).toThrow('toolset namespace "Mail"');
    expect(() => assertToolSegment('send', 'tool name')).not.toThrow();
  });

  it('refuses a wire name over the provider limit', () => {
    expect(() => assertWireNameWithinLimit(['mail', 'a'.repeat(60)])).toThrow('provider limit');
    expect(() => assertWireNameWithinLimit(['mail', 'send'])).not.toThrow();
  });
});

describe('replay subjects and lines (§3.8)', () => {
  it('names a result by what it was and how big, never by what it said', () => {
    expect(describeReplaySubject('page https://x.example/', 'hello')).toBe('page https://x.example/, 5 characters');
  });

  it('gives a subject only to a result long enough to be worth replacing', () => {
    expect(replaySubjectWhenLong('shell output', 'x'.repeat(REPLAY_VERBATIM_MAX_CHARS))).toBeUndefined();
    expect(replaySubjectWhenLong('shell output', 'x'.repeat(REPLAY_VERBATIM_MAX_CHARS + 1))).toBe(
      `shell output, ${REPLAY_VERBATIM_MAX_CHARS + 1} characters`
    );
  });

  it('tells a later turn where the text went and that the call can be made again', () => {
    const line = renderReplayLine('page https://x.example/, 5 characters');
    expect(line).toBe(
      '[page https://x.example/, 5 characters — from an earlier turn; its text is not shown. Make the call again if you need it.]'
    );
  });

  it('tells the turn that made the call what a re-read costs, and gives no instruction to call again', () => {
    const line = renderSupersededLine('page https://x.example/, 5 characters');
    expect(line).toContain('read earlier this turn');
    expect(line).toContain('may displace another result');
    expect(line).toContain('copy what you need into your own text first');
    expect(line).not.toContain('call the tool again');
  });

  it('says a repeat changed nothing', () => {
    expect(renderDuplicateLine('page https://x.example/, 5 characters')).toBe(
      '[page https://x.example/, 5 characters — identical to the result above; nothing changed.]'
    );
  });

  it('should name the earlier read of the same content without saying why they match (§3.8)', () => {
    expect(
      renderSameContentLine('page https://x.example/?page=2, 9 characters', 'page https://x.example/, 5 characters')
    ).toBe(
      '[page https://x.example/?page=2, 9 characters — identical content to page https://x.example/, 5 characters, which is still shown above.]'
    );
  });
});
