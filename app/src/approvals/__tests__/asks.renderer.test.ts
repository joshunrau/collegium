import { describe, expect, it } from 'vitest';

import { renderAskActions, renderAskPrompt, renderResolvedAskPrompt } from '../asks.renderer.ts';

import type { AskPromptInput } from '../asks.renderer.ts';

const PROMPT: AskPromptInput = {
  actionName: 'ask::human',
  contextText: 'Action 3 of 25 · requested by @casey: "book the flight"',
  question: 'Which airport?'
};

describe('renderAskPrompt', () => {
  it('should lead with the action, the turn’s context line and the question', () => {
    expect(renderAskPrompt(PROMPT)).toBe(
      '❓ **Answer needed: `ask::human`**\nAction 3 of 25 · requested by @casey: "book the flight"\n\nWhich airport?'
    );
  });

  it('should name the answers it offered, so the record survives the buttons', () => {
    expect(renderAskPrompt({ ...PROMPT, options: ['Heathrow', 'Gatwick'] })).toContain(
      'Offered answers: Heathrow · Gatwick'
    );
  });
});

describe('renderResolvedAskPrompt', () => {
  it('should quote the answer and name who gave it', () => {
    expect(renderResolvedAskPrompt(PROMPT, { answerText: 'Gatwick', byUsername: 'casey', kind: 'answered' })).toBe(
      '💬 **Answered** by @casey: `ask::human`\n\nWhich airport?\n\n> Gatwick'
    );
  });

  it('should say a cancelled question is no longer waiting, naming what cancelled it (§7.5)', () => {
    expect(renderResolvedAskPrompt(PROMPT, { kind: 'cancelled', reason: 'kill' })).toContain(
      'No longer awaiting an answer** — the turn was killed'
    );
  });
});

describe('renderAskActions', () => {
  it('should sign each offered answer separately and always offer free text (§6.4)', () => {
    const [attachment] = renderAskActions({
      answerUrl: 'http://app/decisions/ask',
      askId: 'ask-1',
      options: ['Heathrow'],
      sign: (parts) => parts.join('|')
    });
    expect(attachment?.actions?.map((action) => action.integration.context)).toStrictEqual([
      { answerText: 'Heathrow', askId: 'ask-1', signature: 'ask|ask-1|Heathrow' },
      { askId: 'ask-1', signature: 'ask|ask-1' }
    ]);
  });
});
