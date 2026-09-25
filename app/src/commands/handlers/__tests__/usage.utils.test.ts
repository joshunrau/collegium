import { describe, expect, it } from 'vitest';

import { renderUsageResponse } from '../usage.utils.ts';

describe('renderUsageResponse', () => {
  it('should footnote a total marked partial even when every row is fully reported or unreported', () => {
    const text = renderUsageResponse(
      {
        rows: [
          {
            agentUsername: 'mira',
            cachedPromptTokens: { coverage: 'full', total: 604_112 },
            completionTokens: 31_208,
            costUsd: { coverage: 'full', total: 2.4137 },
            modelName: 'gpt-5',
            promptTokens: 812_340,
            reasoningTokens: { coverage: 'full', total: 18_530 },
            turnCount: 42
          },
          {
            agentUsername: 'otto',
            cachedPromptTokens: { coverage: 'none' },
            completionTokens: 9870,
            costUsd: { coverage: 'none' },
            modelName: 'deepseek-v4-flash',
            promptTokens: 204_115,
            reasoningTokens: { coverage: 'none' },
            turnCount: 17
          }
        ],
        total: {
          cachedPromptTokens: { coverage: 'partial', total: 604_112 },
          completionTokens: 41_078,
          costUsd: { coverage: 'partial', total: 2.4137 },
          promptTokens: 1_016_455,
          reasoningTokens: { coverage: 'partial', total: 18_530 },
          turnCount: 59
        }
      },
      { completions: 0, tokens: 0 }
    );
    expect(text).toBe(
      [
        'Usage — turns ended in the last 24 hours',
        '',
        '| Agent | Model | Turns | Prompt | Cached | Completion | Reasoning | Cost |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        '| mira | gpt-5 | 42 | 812,340 | 604,112 | 31,208 | 18,530 | $2.4137 |',
        '| otto | deepseek-v4-flash | 17 | 204,115 | — | 9,870 | — | — |',
        '| **Total** |  | 59 | 1,016,455 | 604,112* | 41,078 | 18,530* | $2.4137* |',
        '',
        '* Not reported by every turn in the row.'
      ].join('\n')
    );
  });

  it('should say what the provider did not report of completions the framework cut, apart from every total (§8.2)', () => {
    const text = renderUsageResponse(
      {
        rows: [],
        total: {
          cachedPromptTokens: { coverage: 'none' },
          completionTokens: 0,
          costUsd: { coverage: 'none' },
          promptTokens: 0,
          reasoningTokens: { coverage: 'none' },
          turnCount: 0
        }
      },
      { completions: 2, tokens: 24_310 }
    );
    expect(text).toBe(
      'Usage — turns ended in the last 24 hours: none recorded.\n\n2 completions cut at the time limit or by a steer, about 24,310 tokens not reported by the provider.'
    );
  });
});
