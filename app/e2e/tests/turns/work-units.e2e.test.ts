import { randomUUID } from 'node:crypto';

import { defaultDisplayNameOf } from '@collegium/config';
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
    expect(closing.tail).toContain(`to ${defaultDisplayNameOf(agents.owen.username)} (awaiting your verdict since `);
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

  it('refuses a close while the turn the assignee opened on the unit runs, and closes once it ends (§3.15)', async () => {
    const { agents, channels, inference } = harness();
    const phrase = `venue floor plan ${randomUUID()}`;
    const refused = `refused-${randomUUID()}`;
    const closed = `closed-${randomUUID()}`;
    const working = `working-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: phrase }, assignTo(agents.owen.username, phrase));
    inference.willReply({ agent: 'mira' }, textResponse('handed over'));
    const owenWorking = inference.willBlock({ agent: 'owen' }, textResponse(working));

    await channels.main.mention('mira', `please delegate: ${phrase}`);
    const handOff = await channels.main.awaitPost({
      description: 'the assignment post under mira',
      match: (post) => {
        return post.authorId === agents.mira.userId && post.text.includes('work unit') && post.text.includes(phrase);
      }
    });
    const reference = /work unit `([a-z0-9]+)`/u.exec(handOff.text)?.[1];
    expect(reference).toBeDefined();
    await owenWorking.arrived;

    const cancel = toolCallResponse('tasks__close', {
      reference: reference!,
      state: 'cancelled',
      verdict: 'not needed'
    });
    inference.willReply({ agent: 'mira', contains: 'drop the floor plan' }, cancel);
    inference.willReply({ agent: 'mira' }, textResponse(refused));
    await channels.main.mention('mira', 'drop the floor plan, we no longer need it');
    await channels.main.awaitReplyFrom('mira', { text: refused });
    const read = inference
      .requestsFor('mira')
      .at(-1)!
      .messages.map((message) => message.content ?? '')
      .join('\n');
    expect(read).toContain(`unit ${reference} is still being worked on`);

    owenWorking.release();
    await channels.main.awaitReplyFrom('owen', { text: working });
    inference.willReply({ agent: 'mira', contains: 'drop it now' }, cancel);
    inference.willReply({ agent: 'mira' }, textResponse(closed));
    await channels.main.mention('mira', 'drop it now');
    await channels.main.awaitReplyFrom('mira', { text: closed });
    const posts = await channels.main.posts();
    expect(posts.some((post) => post.text.includes(`\`${reference}\` closed as cancelled: not needed`))).toBe(true);
  });

  it('shows a turn the report it never saw through tasks::read, and closes on it (§3.15)', async () => {
    const { agents, channels, inference } = harness();
    const phrase = `speaker list ${randomUUID()}`;
    const summary = `four speakers confirmed ${randomUUID()}`;
    const closed = `closed-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: phrase }, assignTo(agents.owen.username, phrase));
    inference.willReply({ agent: 'mira' }, textResponse('handed over'));
    const owenWorking = inference.willBlock({ agent: 'owen' }, textResponse('placeholder'));

    await channels.main.mention('mira', `please delegate: ${phrase}`);
    const handOff = await channels.main.awaitPost({
      description: 'the assignment post under mira',
      match: (post) => {
        return post.authorId === agents.mira.userId && post.text.includes('work unit') && post.text.includes(phrase);
      }
    });
    const reference = /work unit `([a-z0-9]+)`/u.exec(handOff.text)?.[1];
    expect(reference).toBeDefined();
    await owenWorking.arrived;

    const miraChecking = inference.willBlock(
      { agent: 'mira', contains: 'how is the speaker list' },
      textResponse('placeholder')
    );
    await channels.main.mention('mira', 'how is the speaker list going?');
    await miraChecking.arrived;
    expect(inference.requestsFor('mira').at(-1)!.tail).toContain(
      `to ${defaultDisplayNameOf(agents.owen.username)} (working here since `
    );

    inference.willReply({ agent: 'owen' }, textResponse('reported'));
    owenWorking.release(toolCallResponse('tasks__report', { reference: reference!, state: 'review', summary }));
    await channels.main.awaitReplyFrom('owen', { text: 'reported' });

    const closeUnit = toolCallResponse('tasks__close', {
      reference: reference!,
      state: 'done',
      verdict: 'meets the criteria'
    });
    inference.willReply({ agent: 'mira' }, toolCallResponse('tasks__read', { reference: reference! }));
    inference.willReply({ agent: 'mira' }, closeUnit);
    inference.willReply({ agent: 'mira' }, textResponse(closed));
    // the report addressed mira while she was working; it drains into one more turn of hers
    inference.willReply({ agent: 'mira' }, textResponse(`drained-${randomUUID()}`));
    miraChecking.release(closeUnit);
    await channels.main.awaitReplyFrom('mira', { text: closed });

    const read = inference
      .requestsFor('mira')
      .find((request) => request.messages.some((message) => message.content?.includes('latest report:')));
    const shown = read!.messages.map((message) => message.content ?? '').join('\n');
    expect(shown).toContain(`the latest report on unit ${reference} is not in what this turn has read`);
    expect(shown).toContain(summary);
    const posts = await channels.main.posts();
    expect(posts.some((post) => post.text.includes(`\`${reference}\` closed as done: meets the criteria`))).toBe(true);
  });

  it('continues a reported unit as the next one to the same assignee, closing it in the same post (§3.15)', async () => {
    const { agents, channels, inference } = harness();
    const phrase = `guest list ${randomUUID()}`;
    const next = `seating plan ${randomUUID()}`;
    const started = `seating-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: phrase }, assignTo(agents.owen.username, phrase));
    inference.willReply({ agent: 'mira' }, textResponse('handed over'));
    const owenFirst = inference.willBlock({ agent: 'owen' }, textResponse('placeholder'));

    await channels.main.mention('mira', `please delegate: ${phrase}`);
    const handOff = await channels.main.awaitPost({
      description: 'the assignment post under mira',
      match: (post) => {
        return post.authorId === agents.mira.userId && post.text.includes('work unit') && post.text.includes(phrase);
      }
    });
    const reference = /work unit `([a-z0-9]+)`/u.exec(handOff.text)?.[1];
    expect(reference).toBeDefined();
    await owenFirst.arrived;

    inference.willReply({ agent: 'owen' }, textResponse('reported'));
    inference.willReply(
      { agent: 'mira' },
      toolCallResponse('tasks__assign', {
        assignee: agents.owen.username,
        context: 'the guest list is in the report',
        criteria: 'every guest seated',
        follows: reference!,
        outcome: next
      })
    );
    inference.willReply({ agent: 'mira' }, textResponse('continued'));
    const owenNext = inference.willBlock({ agent: 'owen' }, textResponse(started));
    owenFirst.release(toolCallResponse('tasks__report', { reference: reference!, state: 'review', summary: 'done' }));

    const continuation = await channels.main.awaitPost({
      description: 'the continuation post under mira',
      match: (post) => {
        return post.authorId === agents.mira.userId && post.text.includes('work unit') && post.text.includes(next);
      }
    });
    expect(continuation.text).toContain(`follows unit \`${reference}\`, now closed as done`);
    const successor = /work unit `([a-z0-9]+)`/u.exec(continuation.text)?.[1];
    await owenNext.arrived;
    const tail = inference.requestsFor('owen').at(-1)!.tail;
    expect(tail).toContain(`[${successor}] from ${defaultDisplayNameOf(agents.mira.username)} (`);
    expect(tail).toContain(`· follows ${reference} — ${next}`);
    expect(tail).not.toContain(`[${reference}]`);
    owenNext.release();
    await channels.main.awaitReplyFrom('owen', { text: started });
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
