import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse, toolCallResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

const SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: ['tasks'],
      username: 'mira'
    },
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Owen. Reply clearly and briefly.',
      tools: ['tasks'],
      username: 'owen'
    }
  ],
  channels: [{ name: 'main' }]
});

describe('Delegation through a work unit', () => {
  const harness = setupHarness(SCENARIO);

  const traceOf = async (postId: string) => {
    const { channels } = harness();
    channels.main.forgetInteractions();
    await channels.main.runCommand(`/collegium trace ${postId}`);
    return (await channels.main.awaitEphemeral({ contains: 'depth' })).message;
  };

  it('hands a unit over, reports it back as a return, and closes it, each as a post (§3.15, §7.4)', async () => {
    const { agents, channels, inference } = harness();
    const phrase = `venue shortlist ${randomUUID()}`;
    const closed = `closed-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: phrase },
      toolCallResponse('tasks__assign', {
        assignee: agents.owen.username,
        context: 'nothing tried yet',
        criteria: 'three venues with prices',
        outcome: phrase
      })
    );
    inference.willReply({ agent: 'mira' }, textResponse('handed over'));
    const owenFirst = inference.willBlock({ agent: 'owen' }, textResponse('placeholder'));

    await channels.main.mention('mira', `please delegate: ${phrase}`);
    const handOff = await channels.main.awaitPost({
      description: 'the assignment post under mira',
      match: (post) => post.authorId === agents.mira.userId && post.text.includes('work unit')
    });
    expect(handOff.text).toContain(`@${agents.owen.username}`);
    expect(handOff.text).toContain('**Criteria:** three venues with prices');
    const reference = /work unit `([a-z0-9]+)`/u.exec(handOff.text)?.[1];
    expect(reference).toBeDefined();

    await owenFirst.arrived;
    inference.willReply({ agent: 'owen' }, textResponse('reported'));
    // owen's own closing text may land inside mira's debounce window, so the return turn is matched by order, not by phrase
    inference.willReply(
      { agent: 'mira' },
      toolCallResponse('tasks__close', { reference: reference!, state: 'done', verdict: 'meets the criteria' })
    );
    inference.willReply({ agent: 'mira' }, textResponse(closed));
    owenFirst.release(
      toolCallResponse('tasks__report', { reference: reference!, state: 'review', summary: 'three venues found' })
    );

    const owenReply = await channels.main.awaitReplyFrom('owen', { text: 'reported' });
    const miraReply = await channels.main.awaitReplyFrom('mira', { text: closed });
    const posts = await channels.main.posts();
    expect(posts.some((post) => post.text.includes(`is ready for review: three venues found`))).toBe(true);
    expect(posts.some((post) => post.text.includes(`closed as done: meets the criteria`))).toBe(true);
    expect(await traceOf(owenReply.id)).toContain('depth 1');
    expect(await traceOf(miraReply.id)).toContain('depth 0');

    const closing = inference.requestsFor('mira').at(-1)!;
    expect(closing.systemPrompt).toContain('## Open work');
    expect(closing.systemPrompt).not.toContain('No work is open in this channel.');
    const afterwards = `afterwards-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'anything open' }, textResponse(afterwards));
    await channels.main.mention('mira', 'anything open?');
    await channels.main.awaitReplyFrom('mira', { text: afterwards });
    expect(inference.requestsFor('mira').at(-1)!.systemPrompt).toContain(
      '## Open work\n\nNo work is open in this channel.'
    );
  });
});
