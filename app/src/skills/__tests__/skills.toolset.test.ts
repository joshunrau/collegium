import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { SkillsService } from '../skills.service.ts';
import { SKILLS_TOOLSET } from '../skills.toolset.ts';

const { load } = SKILLS_TOOLSET.tools;

function buildContext() {
  const skills = MockFactory.createMock(SkillsService);
  const context = { skills, turn: buildToolTurnScope() };
  return { context, skills };
}

describe('SKILLS_TOOLSET', () => {
  it('loads the named skill document', async () => {
    const { context, skills } = buildContext();
    skills.getDocument.mockReturnValue(Result.ok('# Handing Work To A Peer\n\nMention them once.'));
    const result = await executeTool(load, { name: 'handing-work-to-a-peer' }, context);
    expect(skills.getDocument).toHaveBeenCalledWith(context.turn.agentUsername, 'handing-work-to-a-peer', undefined);
    expect(result.unwrap().text).toContain('# Handing Work To A Peer');
    expect(result.unwrap().replaySubject).toBe('loaded skill handing-work-to-a-peer');
  });

  it('loads a named reference of that skill', async () => {
    const { context, skills } = buildContext();
    skills.getDocument.mockReturnValue(Result.ok('# Escalation paths\n\nEscalate when.'));
    const result = await executeTool(load, { name: 'handing-work-to-a-peer', reference: 'escalation-paths' }, context);
    expect(skills.getDocument).toHaveBeenCalledWith(
      context.turn.agentUsername,
      'handing-work-to-a-peer',
      'escalation-paths'
    );
    expect(result.unwrap().replaySubject).toBe('loaded handing-work-to-a-peer reference "escalation-paths"');
  });

  it('quotes a reference in the trace so whitespace is visible (§8.1)', () => {
    expect(load.traceDetail?.({ name: 'bookmark::saving-bookmarks' })).toBe('bookmark::saving-bookmarks');
    expect(load.traceDetail?.({ name: 'bookmark::saving-bookmarks', reference: ' ' })).toBe(
      'bookmark::saving-bookmarks reference " "'
    );
  });

  it('rejects a whitespace-only reference at the perimeter, naming omission as the way out', () => {
    const parsed = load.parameters.safeParse({ name: 'understanding-collegium', reference: ' ' });
    expect(parsed.success).toBe(false);
    expect(z.prettifyError(parsed.error ?? new z.ZodError([]))).toContain(
      'reference must name a document, or be omitted to load the skill itself'
    );
  });

  it('returns an unknown name to the model as its own recoverable mistake', async () => {
    const { context, skills } = buildContext();
    skills.getDocument.mockReturnValue(Result.err({ message: 'no skill named "nope" is in your manifest' }));
    const result = await executeTool(load, { name: 'nope' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'no skill named "nope" is in your manifest'
    });
  });

  it('is budget-exempt and retryable (§5.3, §7.2)', () => {
    expect(load.budgetExempt).toBe(true);
    expect(load.retryable).toBe(true);
  });
});
