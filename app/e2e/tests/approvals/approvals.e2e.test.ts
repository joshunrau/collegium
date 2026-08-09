import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { setupHarness } from '../../support/harness.ts';
import { textResponse, toolCallResponse, toolCallsResponse } from '../../support/inference.ts';
import { defineScenario } from '../../support/scenario.ts';

const SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      skills: ['handing-work-to-a-peer'],
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      tools: ['load_skill', 'read_memory', 'write_file', 'write_memory'],
      username: 'mira'
    }
  ],
  channels: [{ name: 'main' }]
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Approval prompts', () => {
  const harness = setupHarness(SCENARIO);

  const awaitPrompt = (marker: string) =>
    harness().channels.main.awaitPost({
      description: `the approval prompt carrying "${marker}"`,
      match: (post) => post.text.includes('Approval required') && post.text.includes(marker)
    });

  it('posts a prompt showing the full payload before a gated tool executes (§6.2)', async () => {
    const { agents, app, channels, inference } = harness();
    const content = `meeting notes ${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'payload check' },
      toolCallResponse('write_file', { content, path: 'payload-check.md' })
    );

    await channels.main.mention('mira', 'payload check');
    const prompt = await awaitPrompt(content);

    expect(prompt.text).toContain('payload-check.md');
    expect(fs.existsSync(path.join(app.workspaceDirFor(agents.mira.username), 'payload-check.md'))).toBe(false);

    const reply = `written-${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, textResponse(reply));
    await channels.main.clickAction(prompt, 'approve');
    await channels.main.awaitReplyFrom('mira', { text: reply });
  });

  it('posts no prompt for a read-only tool (§6.2)', async () => {
    const { channels, inference } = harness();
    const reply = `read-only-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'read something' },
      toolCallResponse('load_skill', { name: 'handing-work-to-a-peer' })
    );
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'read something');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    const posts = await channels.main.posts();
    expect(posts.some((post) => post.text.includes('Approval required'))).toBe(false);
  });

  // there is no shell in this roadmap's scope; the never-collapse rule joins the shell capability
  it.todo('presents a shell command in full rather than behind an expandable control (§6.2)');

  it('waits indefinitely rather than timing out (§3.7)', async () => {
    const { channels, inference } = harness();
    const marker = `patient-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'be patient' },
      toolCallResponse('write_file', { content: marker, path: 'patient.md' })
    );

    await channels.main.mention('mira', 'be patient');
    const prompt = await awaitPrompt(marker);
    await sleep(2000);

    const current = await channels.main.posts();
    const stillPending = current.find((post) => post.id === prompt.id);
    expect(stillPending?.text).toContain('Approval required');
    expect(stillPending?.text).not.toContain('No longer awaiting');

    const reply = `patient-done-${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, textResponse(reply));
    await channels.main.clickAction(prompt, 'approve');
    await channels.main.awaitReplyFrom('mira', { text: reply });
  });

  it('accepts a resolution from any human in the channel (§3.7)', async () => {
    const { agents, app, channels, inference } = harness();
    const marker = `anyone-${randomUUID()}`;
    const reply = `anyone-done-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'ask anyone' },
      toolCallResponse('write_file', { content: marker, path: 'anyone.md' })
    );
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'ask anyone');
    const prompt = await awaitPrompt(marker);
    await channels.main.clickAction(prompt, 'approve');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    expect(fs.readFileSync(path.join(app.workspaceDirFor(agents.mira.username), 'anyone.md'), 'utf8')).toBe(marker);
  });
});

describe('Approval resolution', () => {
  const harness = setupHarness(SCENARIO);

  const awaitPrompt = (marker: string) =>
    harness().channels.main.awaitPost({
      description: `the approval prompt carrying "${marker}"`,
      match: (post) => post.text.includes('Approval required') && post.text.includes(marker)
    });

  it('executes the tool, continues the turn, and rewrites the prompt once approved (§3.7)', async () => {
    const { agents, app, channels, inference } = harness();
    const content = `approved content ${randomUUID()}`;
    const reply = `approved-done-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'write it' },
      toolCallResponse('write_file', { content, path: 'approved.md' })
    );
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'write it');
    const prompt = await awaitPrompt(content);
    await channels.main.clickAction(prompt, 'approve');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    expect(fs.readFileSync(path.join(app.workspaceDirFor(agents.mira.username), 'approved.md'), 'utf8')).toBe(content);
    const rewritten = await channels.main.awaitPostUpdate(prompt, { contains: 'Approved' });
    expect(rewritten.id).toBe(prompt.id);
  });

  it('refuses a resolution from a human who is not in the channel (§3.7)', async () => {
    const { agents, app, channels, inference } = harness();
    const marker = `outsider content ${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'ask an outsider' },
      toolCallResponse('write_file', { content: marker, path: 'outsider.md' })
    );

    await channels.main.mention('mira', 'ask an outsider');
    const prompt = await awaitPrompt(marker);
    const outsider = await channels.main.provisionHumanOutsideChannel(`outsider-${randomUUID().slice(0, 8)}`);
    // Mattermost surfaces the app's refusal as a non-2xx, which the client raises
    await channels.main.clickActionAs(outsider, prompt, 'approve').catch(() => undefined);
    await sleep(1000);

    const pending = (await channels.main.posts()).find((post) => post.id === prompt.id);
    expect(pending?.text).toContain('Approval required');
    expect(fs.existsSync(path.join(app.workspaceDirFor(agents.mira.username), 'outsider.md'))).toBe(false);

    const reply = `outsider-done-${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, textResponse(reply));
    await channels.main.clickAction(prompt, 'approve');
    await channels.main.awaitReplyFrom('mira', { text: reply });
  });

  it('terminates the turn on a bare denial and posts asking how to proceed (§5.4)', async () => {
    const { agents, app, channels, inference } = harness();
    const marker = `denied content ${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'try something' },
      toolCallResponse('write_file', { content: marker, path: 'denied.md' })
    );

    await channels.main.mention('mira', 'try something');
    const prompt = await awaitPrompt(marker);
    await channels.main.clickAction(prompt, 'deny');
    await channels.main.awaitPost({
      description: 'the how-to-proceed follow-up',
      match: (post) => post.authorId === agents.mira.userId && post.text.includes('How would you like me to proceed')
    });

    expect(fs.existsSync(path.join(app.workspaceDirFor(agents.mira.username), 'denied.md'))).toBe(false);
  });

  it('feeds the reason back as the tool result and continues the turn on denial with reason (§5.4)', async () => {
    const { channels, inference } = harness();
    const marker = `reasoned content ${randomUUID()}`;
    const reply = `reasoned-done-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'reason with me' },
      toolCallResponse('write_file', { content: marker, path: 'reasoned.md' })
    );
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'reason with me');
    const prompt = await awaitPrompt(marker);
    await channels.main.clickAction(prompt, 'reason');
    const dialog = await channels.main.awaitDialog();
    await channels.main.submitDialog(dialog, { reason: 'use a different name' });
    await channels.main.awaitReplyFrom('mira', { text: reply });

    const retry = inference.requestsFor('mira').at(-1);
    const toolResult = retry?.messages.find((message) => message.role === 'tool');
    expect(toolResult?.content).toBe('denied: use a different name');
  });

  it('counts a denial against the action budget (§5.4)', async () => {
    const { agents, channels, inference } = harness();
    const marker = `budgeted content ${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'burn the budget' },
      toolCallsResponse([
        ...Array.from({ length: 9 }, (_, index) => ({
          arguments: { body: `note ${index}`, description: `budget filler ${index}` },
          name: 'write_memory'
        })),
        { arguments: { content: marker, path: 'budgeted.md' }, name: 'write_file' }
      ])
    );
    inference.willReply({ agent: 'mira' }, toolCallResponse('write_file', { content: marker, path: 'retry.md' }));

    await channels.main.mention('mira', 'burn the budget');
    const prompt = await awaitPrompt(marker);
    channels.main.forgetInteractions();
    await channels.main.clickAction(prompt, 'reason');
    const dialog = await channels.main.awaitDialog();
    await channels.main.submitDialog(dialog, { reason: 'not yet' });

    // the denial spent the tenth attempt, so the retry is the eleventh and asks to extend
    const extension = await channels.main.awaitPost({
      description: 'the extension prompt carrying the running count',
      match: (post) => post.authorId === agents.mira.userId && post.text.includes('extension 1; 10 attempts so far')
    });
    await channels.main.clickAction(extension, 'deny');
    await channels.main.awaitPost({
      description: 'the budget exhaustion notice',
      match: (post) => post.authorId === agents.mira.userId && post.text.includes('action attempts')
    });
  });
});

describe('Action budget', () => {
  const harness = setupHarness(SCENARIO);

  const burn = (marker: string) =>
    toolCallsResponse(
      Array.from({ length: 11 }, (_, index) => ({
        arguments: { body: `note ${index} ${marker}`, description: `filler ${index}` },
        name: 'write_memory'
      }))
    );

  it('posts what it has and requests an extension after ten action attempts (§5.3)', async () => {
    const { agents, channels, inference } = harness();
    inference.willReply({ agent: 'mira', contains: 'work hard' }, burn('first'));

    await channels.main.mention('mira', 'work hard');
    const extension = await channels.main.awaitPost({
      description: 'the extension prompt',
      match: (post) => post.authorId === agents.mira.userId && post.text.includes('extension 1; 10 attempts so far')
    });

    const reply = `extended-${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, textResponse(reply));
    await channels.main.clickAction(extension, 'approve');
    await channels.main.awaitReplyFrom('mira', { text: reply });
  });

  it('grants a further ten attempts and preserves context when the extension is approved (§5.3)', async () => {
    const { agents, channels, inference } = harness();
    inference.forgetRequests();
    inference.willReply({ agent: 'mira', contains: 'push through' }, burn('second'));

    await channels.main.mention('mira', 'push through');
    const extension = await channels.main.awaitPost({
      description: 'the extension prompt',
      match: (post) => post.authorId === agents.mira.userId && post.text.includes('extension 1; 10 attempts so far')
    });

    const reply = `persevered-${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, textResponse(reply));
    await channels.main.clickAction(extension, 'approve');
    await channels.main.awaitReplyFrom('mira', { text: reply });

    // the eleventh attempt ran against the context accumulated before the extension
    const finalRequest = inference.requestsFor('mira').at(-1);
    expect(finalRequest?.messages.filter((message) => message.role === 'tool')).toHaveLength(11);
  });

  it('ends the turn when the extension is denied (§5.3)', async () => {
    const { agents, channels, inference } = harness();
    inference.willReply({ agent: 'mira', contains: 'one more push' }, burn('third'));

    await channels.main.mention('mira', 'one more push');
    const extension = await channels.main.awaitPost({
      description: 'the extension prompt',
      match: (post) => post.authorId === agents.mira.userId && post.text.includes('extension 1; 10 attempts so far')
    });
    await channels.main.clickAction(extension, 'deny');
    await channels.main.awaitPost({
      description: 'the budget exhaustion notice',
      match: (post) => post.authorId === agents.mira.userId && post.text.includes('I used all')
    });

    const sentinelReply = `after-denial-${randomUUID()}`;
    inference.willReply({ agent: 'mira', contains: 'sentinel' }, textResponse(sentinelReply));
    await channels.main.mention('mira', 'sentinel');
    await channels.main.awaitReplyFrom('mira', { text: sentinelReply });
  });
});

// a decision the app wrongly accepts leaves its turn mid-flight, so these keep their own harness
describe('Approver identity', () => {
  const harness = setupHarness(SCENARIO);

  const awaitPrompt = (marker: string) =>
    harness().channels.main.awaitPost({
      description: `the approval prompt carrying "${marker}"`,
      match: (post) => post.text.includes('Approval required') && post.text.includes(marker)
    });

  it('records the approver the user id resolves to, not the name supplied in the body (§3.7)', async () => {
    const { app, channels, inference } = harness();
    const marker = `byline content ${randomUUID()}`;
    const reply = `byline-done-${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'check the byline' },
      toolCallResponse('write_file', { content: marker, path: 'byline.md' })
    );
    inference.willReply({ agent: 'mira' }, textResponse(reply));

    await channels.main.mention('mira', 'check the byline');
    const prompt = await awaitPrompt(marker);
    const approvalId = app.pendingApprovalId();
    const me = await channels.main.whoAmI();
    await fetch(`${app.url}/decisions`, {
      body: JSON.stringify({
        context: { action: 'approve', approval_id: approvalId },
        user_id: me.id,
        user_name: 'ceo-of-acme'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });

    await channels.main.awaitReplyFrom('mira', { text: reply });
    const rewritten = await channels.main.awaitPostUpdate(prompt, { contains: 'Approved' });
    expect(rewritten.text).toContain(me.username);
    expect(rewritten.text).not.toContain('ceo-of-acme');
  });

  it('refuses a decision from a bot present in the channel (§3.7)', async () => {
    const { agents, app, channels, inference } = harness();
    const marker = `bot content ${randomUUID()}`;
    inference.willReply(
      { agent: 'mira', contains: 'let a bot decide' },
      toolCallResponse('write_file', { content: marker, path: 'bot-decided.md' })
    );

    await channels.main.mention('mira', 'let a bot decide');
    const prompt = await awaitPrompt(marker);
    const approvalId = app.pendingApprovalId();
    await fetch(`${app.url}/decisions`, {
      body: JSON.stringify({
        context: { action: 'approve', approval_id: approvalId },
        user_id: agents.mira.userId,
        user_name: agents.mira.username
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    await sleep(1500);

    const pending = (await channels.main.posts()).find((post) => post.id === prompt.id);
    expect(pending?.text).toContain('Approval required');

    const reply = `bot-refused-${randomUUID()}`;
    inference.willReply({ agent: 'mira' }, textResponse(reply));
    await channels.main.clickAction(prompt, 'approve');
    await channels.main.awaitReplyFrom('mira', { text: reply });
  });
});
