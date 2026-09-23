import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse, toolCallResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: ['tasks', 'workspace'],
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
    // §5.2 — mira's return turn starts once owen's ends, and reads the report and owen's reply together
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
    expect(closing.tail).toContain('## Open work');
    expect(closing.tail).not.toContain('No work is open in this channel.');
    const afterwards = `afterwards-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'anything open' }, textResponse(afterwards));
    await channels.main.mention('mira', 'anything open?');
    await channels.main.awaitReplyFrom('mira', { text: afterwards });
    expect(inference.requestsFor('mira').at(-1)!.tail).toContain('## Open work\n\nNo work is open in this channel.');
  });

  const assignTo = (assignee: string, outcome: string) => {
    return toolCallResponse('tasks__assign', {
      assignee,
      context: 'nothing tried yet',
      criteria: 'three quotes with prices',
      outcome
    });
  };

  it('starts the assignee once the assigning turn ends, in one turn that reads both of its posts (§4.5, §5.2)', async () => {
    const { agents, channels, inference } = harness();
    const phrase = `catering quotes ${randomUUID()}`;
    const closing = `and ask about vegetarian options ${randomUUID()}`;
    const acknowledged = `on it ${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: phrase }, assignTo(agents.owen.username, phrase));
    const miraClosing = inference.willBlock({ agent: 'mira' }, textResponse(`@${agents.owen.username} ${closing}`));
    // scripted twice so a second activation shows up in the count rather than as an unscripted failure
    inference.willReply({ agent: 'owen' }, textResponse(acknowledged), { times: 2 });
    const before = inference.requestsFor('owen').length;

    await channels.main.mention('mira', `please delegate: ${phrase}`);
    await channels.main.awaitPost({
      description: 'the assignment post under mira',
      match: (post) => post.authorId === agents.mira.userId && post.text.includes(phrase)
    });
    await miraClosing.arrived;
    await sleep(1000);
    expect(inference.requestsFor('owen')).toHaveLength(before);

    miraClosing.release();
    await channels.main.awaitReplyFrom('owen', { text: acknowledged });
    await sleep(2000);
    const owenTurns = inference.requestsFor('owen').slice(before);
    expect(owenTurns).toHaveLength(1);
    const read = owenTurns[0]!.messages.map((message) => message.content ?? '').join('\n');
    expect(read).toContain(phrase);
    expect(read).toContain(closing);
  });

  it('starts the assignee while the assigning turn waits on a person (§3.7, §5.2)', async () => {
    const { agents, channels, inference } = harness();
    const phrase = `venue deposit ${randomUUID()}`;
    const marker = `gated-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: phrase }, assignTo(agents.owen.username, phrase));
    inference.willReply(
      { agent: 'mira' },
      toolCallResponse('workspace__write', { content: marker, path: 'deposit.md' })
    );
    const owenStarted = inference.willBlock({ agent: 'owen' }, textResponse(`started-${randomUUID()}`));

    await channels.main.mention('mira', `please delegate: ${phrase}`);
    const prompt = await channels.main.awaitPost({
      description: 'the approval prompt mira is parked on',
      match: (post) => post.text.includes('Approval required') && post.text.includes(marker)
    });
    await owenStarted.arrived;

    owenStarted.release();
    await channels.main.clickAction(prompt, 'deny');
  });

  it('queues the assignee a restart kept waiting, so the hand-off is answered after boot (§5.2, §7.3)', async () => {
    const { agents, app, channels, inference } = harness();
    const phrase = `survives the restart ${randomUUID()}`;
    const answered = `answered-after-boot-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: phrase }, assignTo(agents.owen.username, phrase));
    const miraCutOff = inference.willBlock({ agent: 'mira' }, textResponse('never posted'));

    await channels.main.mention('mira', `please delegate: ${phrase}`);
    await channels.main.awaitPost({
      description: 'the assignment post under mira',
      match: (post) => post.authorId === agents.mira.userId && post.text.includes(phrase)
    });
    await miraCutOff.arrived;

    inference.willReply({ agent: 'owen' }, textResponse(answered));
    await app.restart();
    await channels.main.awaitReplyFrom('owen', { text: answered });
  });
});
