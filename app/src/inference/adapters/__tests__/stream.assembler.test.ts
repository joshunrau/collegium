import { describe, expect, it } from 'vitest';

import { StreamAssembler } from '../stream.assembler.ts';

const delta = (delta: object, finishReason: null | string = null) => ({
  choices: [{ delta, finish_reason: finishReason }]
});

describe('StreamAssembler', () => {
  it('should concatenate text and reasoning across chunks and keep the last finish reason', () => {
    const assembler = new StreamAssembler();
    assembler.absorb(delta({ content: 'Hel', reasoning_content: 'be' }));
    assembler.absorb(delta({ content: 'lo', reasoning_content: 'cause' }, 'stop'));
    expect(assembler.finish()).toMatchObject({ content: 'Hello', finishReason: 'stop', reasoningContent: 'because' });
  });

  it('should accumulate each tool call under its index, the arguments arriving in pieces', () => {
    const assembler = new StreamAssembler();
    assembler.absorb(
      delta({ tool_calls: [{ function: { arguments: '{"a"', name: 'read' }, id: 'call-1', index: 0 }] })
    );
    assembler.absorb(delta({ tool_calls: [{ function: { name: 'write' }, id: 'call-2', index: 1 }] }));
    assembler.absorb(delta({ tool_calls: [{ function: { arguments: ':1}' }, index: 0 }] }));
    assembler.absorb(delta({ tool_calls: [{ function: { arguments: '{}' }, index: 1 }] }, 'tool_calls'));
    expect(assembler.finish().toolCalls).toStrictEqual([
      { arguments: '{"a":1}', id: 'call-1', name: 'read' },
      { arguments: '{}', id: 'call-2', name: 'write' }
    ]);
  });

  it('should continue a reasoning block across chunks sharing its index and start a new one otherwise', () => {
    const assembler = new StreamAssembler();
    assembler.absorb(delta({ reasoning_details: [{ index: 0, text: 'first ', type: 'reasoning.text' }] }));
    assembler.absorb(delta({ reasoning_details: [{ index: 0, signature: 'sig', text: 'thought' }] }));
    assembler.absorb(delta({ reasoning_details: [{ data: 'enc', index: 1, type: 'reasoning.encrypted' }] }));
    expect(assembler.finish().reasoningDetails).toStrictEqual([
      { index: 0, signature: 'sig', text: 'first thought', type: 'reasoning.text' },
      { data: 'enc', index: 1, type: 'reasoning.encrypted' }
    ]);
  });

  it('should keep both the reasoning text and its blocks when a stream carries both, as OpenRouter may', () => {
    const assembler = new StreamAssembler();
    assembler.absorb(
      delta({ reasoning: 'why', reasoning_details: [{ index: 0, text: 'why', type: 'reasoning.text' }] })
    );
    expect(assembler.finish()).toMatchObject({
      reasoningContent: 'why',
      reasoningDetails: [{ index: 0, text: 'why', type: 'reasoning.text' }]
    });
  });

  it('should take usage from the chunk that carries it and report a mid-stream error', () => {
    const assembler = new StreamAssembler();
    assembler.absorb({ choices: [], usage: { completionTokens: 2, promptTokens: 3 } as never });
    assembler.absorb({ error: { code: 502, message: 'upstream down' } });
    expect(assembler.failed).toBe(true);
    expect(assembler.finish()).toMatchObject({ error: { code: 502, message: 'upstream down' } });
  });
});
