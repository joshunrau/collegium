// Drives a bakeoff task on the test agents of a live instance over the Mattermost REST API.
// State (token, run.json, traces) lives under RUN_DIR, which defaults to scratch/live-run in the repo; never committed.
//   node driver.mjs login
//   node driver.mjs task <taskfile> [--agents ds,glm,luna]
//   node driver.mjs cmd <agentKey> "<slash command>"
//   node driver.mjs post <agentKey> "<message>"
//   node driver.mjs trace <agentKey> <postId> <outfile>
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const MM = 'https://chat.internal.clinivance.com';
const TEAM = '3h7ep7gifff7meqj8hrazsebto';
const REPO = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const RUN_DIR = process.env.RUN_DIR ?? `${REPO}/scratch/live-run`;
const TASKS_DIR = process.env.TASKS_DIR ?? path.resolve(import.meta.dirname, '..', 'tasks');
const TOKEN_FILE = path.join(RUN_DIR, 'token.txt');
fs.mkdirSync(path.join(RUN_DIR, 'traces'), { recursive: true });
const FIX = process.env.FIX ?? 'http://fixtures.internal.clinivance.com/northmoor';
const POLL_MS = 15_000;
const TURN_TIMEOUT_MS = 10 * 60_000;
const AGENTS = {
  ds: {
    username: 'tester-ds',
    id: 's8ih5gtabtnn5gsjpt38zoi9gy',
    channel: '6u1hitcdd3f4zd3u13rsqgps4r',
    channelName: 'bakeoff-ds'
  },
  glm: {
    username: 'tester-glm',
    id: 'go75x5u9hfgupy796accmrdpsr',
    channel: 'yq3r9hocbjr6ikd3tbqsrd7gxw',
    channelName: 'bakeoff-glm'
  },
  luna: {
    username: 'tester-luna',
    id: '41c891ywii8d7j18yt71rubbgy',
    channel: 'rfsric38n3napfq9kx7d5xb6ho',
    channelName: 'bakeoff-luna'
  }
};
const WORKING = '⏳';
const TERMINAL = ['✅', '⚠️', '🛑', '⏸️', '⏹️'];
const PROMPT = ['🔐', '❓'];
const STATUS_RE = /^(⏳ _working|✅ _done|⚠️ _stopped|🛑 _stopped|⏸️ _stopped|⏹️ _stopped)/u;
const DECISION_RE = /^(✅ \*\*Approved\*\*|↩️ \*\*Denied|❌ \*\*Denied|🛑 \*\*Denied|✅ \*\*Answered|💬 \*\*Answered)/u;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
const log = (tag, message) => console.log(`${now().slice(11, 19)} [${tag}] ${message}`);

function token() {
  return fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
}

async function api(method, route, body) {
  const response = await fetch(`${MM}/api/v4${route}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${route} -> ${response.status}: ${text.slice(0, 300)}`);
  }
  return text.length === 0 ? null : JSON.parse(text);
}

async function login() {
  const env = fs.readFileSync(`${REPO}/.env`, 'utf-8');
  const get = (key) => env.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1];
  const response = await fetch(`${MM}/api/v4/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login_id: get('CLAUDE_MATTERMOST_EMAIL'), password: get('CLAUDE_MATTERMOST_PASSWORD') })
  });
  const session = response.headers.get('token');
  if (!response.ok || !session) {
    throw new Error(`login failed: ${response.status}`);
  }
  fs.writeFileSync(TOKEN_FILE, session);
  const me = await response.json();
  log('login', `ok as ${me.username}`);
}

const post = (channelId, message) => api('POST', '/posts', { channel_id: channelId, message });
const postsSince = async (channelId, sinceMs) => {
  const page = await api('GET', `/channels/${channelId}/posts?since=${sinceMs}&per_page=200`);
  return page.order.map((id) => page.posts[id]).sort((a, b) => a.create_at - b.create_at);
};
const command = async (channelId, text) =>
  api('POST', '/commands/execute', { channel_id: channelId, team_id: TEAM, command: text });
const pressButton = (postId, actionId) => api('POST', `/posts/${postId}/actions/${actionId}`, {});
const actionsOf = (p) => (p.props?.attachments ?? []).flatMap((a) => a.actions ?? []);
const isPrompt = (p) => actionsOf(p).length > 0 && startsWithAny(p.message, PROMPT);
const startsWithAny = (text, markers) => markers.some((m) => text.startsWith(m));

function dialog(postId, actionId, field, text) {
  const result = spawnSync(
    'node',
    [
      `${REPO}/benchmark/scripts/dialog.js`,
      '--url',
      MM,
      '--token',
      token(),
      '--post',
      postId,
      '--action',
      actionId,
      '--field',
      field,
      '--text',
      text
    ],
    { encoding: 'utf-8' }
  );
  if (result.status !== 0) {
    throw new Error(`dialog failed: ${result.stdout} ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function saveTrace(agent, postId, file) {
  const response = await command(agent.channel, `/collegium trace ${postId}`);
  fs.writeFileSync(file, response.text ?? '');
  fs.writeFileSync(`${file}.json`, JSON.stringify({ ...response, text: undefined }, null, 2));
  return (response.text ?? '').length;
}

async function decidePrompt(tag, agent, prompt, queue, record) {
  const actions = actionsOf(prompt);
  const heading = prompt.message.split('\n')[0];
  record.promptPostIds.push(prompt.id);
  if (prompt.message.startsWith('❓')) {
    const step = queue.find((s) => s.ask);
    if (step) queue.splice(queue.indexOf(step), 1);
    const answer = step?.ask.answer ?? 'Use your best judgment and continue.';
    if (!step) record.notes.push(`unexpected ask at ${now()}: ${heading} -> answered "${answer}"`);
    const option = actions.find((a) => a.name === answer);
    if (option) {
      await pressButton(prompt.id, option.id);
    } else {
      dialog(prompt.id, 'answer', 'answer', answer);
    }
    log(tag, `answered ask "${heading}" with "${answer}"`);
    return;
  }
  const isBudget = heading.includes('extend_budget');
  const index = queue.findIndex((s) => s.approval && (isBudget ? s.approval.budget === true : !s.approval.budget));
  let step = index >= 0 ? queue[index] : undefined;
  if (step && !step.approval.repeat) queue.splice(index, 1);
  const BUDGET_REASON =
    'You have already read every page you need, more than once. Stop and report the answer from what you have.';
  const decision =
    step?.approval ??
    (heading.includes('extend_budget')
      ? { decision: 'deny-with-reason', reason: BUDGET_REASON }
      : { decision: 'approve' });
  if (!step) record.notes.push(`unscripted approval at ${now()}: ${heading} -> ${decision.decision}`);
  if (decision.decision === 'deny-with-reason') {
    dialog(prompt.id, 'reason', 'reason', decision.reason);
  } else {
    await pressButton(prompt.id, decision.decision);
  }
  record.decisions.push({
    promptPostId: prompt.id,
    heading,
    decision: decision.decision,
    reason: decision.reason,
    at: now()
  });
  log(tag, `decided "${heading}" -> ${decision.decision}${decision.reason ? ` (${decision.reason})` : ''}`);
}

async function waitTurn(tag, agent, sinceMs, queue, record) {
  const handled = new Set();
  const started = Date.now();
  let terminalSeenAt;
  while (true) {
    const posts = await postsSince(agent.channel, sinceMs);
    for (const p of posts) {
      if (isPrompt(p) && !handled.has(p.id)) {
        handled.add(p.id);
        try {
          await decidePrompt(tag, agent, p, queue, record);
        } catch (error) {
          record.notes.push(`decision failed on ${p.id} at ${now()}: ${String(error).slice(0, 200)}`);
          log(tag, `decision failed on ${p.id}: ${String(error).slice(0, 120)}`);
        }
      }
    }
    const status = posts.find((p) => p.user_id === agent.id && STATUS_RE.test(p.message));
    const replies = posts.filter(
      (p) =>
        p.user_id === agent.id &&
        p.message.length > 0 &&
        !STATUS_RE.test(p.message) &&
        !DECISION_RE.test(p.message) &&
        !startsWithAny(p.message, PROMPT)
    );
    if (status && startsWithAny(status.message, TERMINAL)) {
      if (terminalSeenAt === undefined) {
        terminalSeenAt = Date.now();
        if (replies.length === 0) {
          await sleep(5000);
          continue;
        }
      }
      return { status, replies, outcome: status.message.split('\n')[0] };
    }
    const newest = Math.max(0, ...posts.map((p) => Math.max(p.create_at, p.update_at)));
    if (replies.length > 0 && Date.now() - newest > 90_000 && !posts.some((p) => isPrompt(p) && !handled.has(p.id))) {
      record.notes.push(
        `reply settled without a terminal status marker at ${now()} (status post ${status?.id ?? 'none'}, ${status?.message.length ?? 0} chars)`
      );
      return {
        status,
        replies,
        outcome: `settled-without-terminal (${status?.message.split('\n')[0] ?? 'no status'})`
      };
    }
    if (Date.now() - started > TURN_TIMEOUT_MS) {
      return { status, replies, outcome: 'timeout' };
    }
    await sleep(POLL_MS);
  }
}

async function runTask(taskId, task, key) {
  const agent = AGENTS[key];
  const tag = key;
  const substitute = (text) => text.replaceAll('{agent}', agent.username).replaceAll('{FIX}', FIX);
  const record = {
    task: taskId,
    agent: agent.username,
    model: key,
    channel: agent.channel,
    startedAt: now(),
    turns: [],
    promptPostIds: [],
    decisions: [],
    notes: []
  };
  const steps = [...task.steps];
  while (steps.length > 0) {
    const step = steps.shift();
    if (step.command) {
      const response = await command(agent.channel, substitute(step.command));
      record.notes.push(`command ${substitute(step.command)} -> ${(response?.text ?? '').slice(0, 120)}`);
      log(tag, `ran ${substitute(step.command)}`);
      await sleep(3000);
      continue;
    }
    if (!step.post) continue;
    const queue = [];
    while (steps.length > 0 && (steps[0].approval || steps[0].ask)) queue.push(steps.shift());
    const human = await post(agent.channel, substitute(step.post));
    const turn = {
      humanPostId: human.id,
      postedAt: now(),
      statusPostId: undefined,
      replyPostIds: [],
      outcome: undefined,
      endedAt: undefined,
      traceChars: 0
    };
    record.turns.push(turn);
    log(tag, `posted ${human.id}: ${substitute(step.post).slice(0, 80)}`);
    const result = await waitTurn(tag, agent, human.create_at - 1000, queue, record);
    turn.statusPostId = result.status?.id;
    turn.replyPostIds = result.replies.map((p) => p.id);
    turn.replies = result.replies.map((p) => p.message);
    turn.outcome = result.outcome;
    turn.endedAt = now();
    log(tag, `turn ended: ${result.outcome} with ${result.replies.length} reply post(s)`);
    const traceTarget = turn.statusPostId ?? turn.replyPostIds[0];
    if (traceTarget) {
      const file = path.join(RUN_DIR, 'traces', `${taskId}-${key}-${record.turns.length}.md`);
      turn.traceChars = await saveTrace(agent, traceTarget, file);
      log(tag, `trace ${turn.traceChars} chars -> ${path.basename(file)}`);
    }
    if (queue.some((s) => !s.approval?.repeat)) record.notes.push(`unused scripted steps: ${JSON.stringify(queue)}`);
  }
  record.endedAt = now();
  return record;
}

async function resumeTask(taskId, task, key, humanPostId, stepIndex) {
  const agent = AGENTS[key];
  const human = await api('GET', `/posts/${humanPostId}`);
  const record = {
    task: taskId,
    agent: agent.username,
    model: key,
    channel: agent.channel,
    startedAt: new Date(human.create_at).toISOString(),
    turns: [],
    promptPostIds: [],
    decisions: [],
    notes: [`resumed by driver from post ${humanPostId}`]
  };
  const steps = task.steps.slice(stepIndex + 1);
  const queue = [];
  while (steps.length > 0 && (steps[0].approval || steps[0].ask)) queue.push(steps.shift());
  const turn = { humanPostId, postedAt: record.startedAt, replyPostIds: [], traceChars: 0 };
  record.turns.push(turn);
  const result = await waitTurn(key, agent, human.create_at - 1000, queue, record);
  turn.statusPostId = result.status?.id;
  turn.replyPostIds = result.replies.map((p) => p.id);
  turn.replies = result.replies.map((p) => p.message);
  turn.outcome = result.outcome;
  turn.endedAt = now();
  log(key, `turn ended: ${result.outcome} with ${result.replies.length} reply post(s)`);
  const target = turn.statusPostId ?? turn.replyPostIds[0];
  if (target) {
    const file = path.join(HERE, 'traces', `${taskId}-${key}-${record.turns.length}.md`);
    turn.traceChars = await saveTrace(agent, target, file);
    log(key, `trace ${turn.traceChars} chars`);
  }
  record.endedAt = now();
  return record;
}

function appendRun(records) {
  const file = path.join(RUN_DIR, 'run.json');
  const run = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : { startedAt: now(), entries: [] };
  for (const r of records) {
    const i = run.entries.findIndex((e) => e.task === r.task && e.model === r.model);
    if (i >= 0) {
      r.startedAt = run.entries[i].startedAt < r.startedAt ? run.entries[i].startedAt : r.startedAt;
      r.notes = [...run.entries[i].notes, ...r.notes];
      run.entries[i] = r;
    } else run.entries.push(r);
  }
  run.updatedAt = now();
  fs.writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
}

const [, , verb, ...rest] = process.argv;
if (verb === 'login') {
  await login();
} else if (verb === 'task') {
  const taskFile = rest[0].includes('/') ? rest[0] : path.join(TASKS_DIR, `${rest[0]}.json`);
  const task = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
  const keys = (rest.includes('--agents') ? rest[rest.indexOf('--agents') + 1] : 'ds,glm,luna').split(',');
  log('run', `task ${task.id} "${task.title}" on ${keys.join(', ')}`);
  const records = await Promise.all(
    keys.map((key) =>
      runTask(task.id, task, key).catch((error) => ({
        task: task.id,
        agent: AGENTS[key].username,
        model: key,
        channel: AGENTS[key].channel,
        startedAt: now(),
        endedAt: now(),
        turns: [],
        promptPostIds: [],
        decisions: [],
        notes: [`driver failed: ${String(error).slice(0, 300)}`]
      }))
    )
  );
  appendRun(records);
  for (const r of records) {
    console.log(`\n=== ${r.model} ===`);
    for (const t of r.turns) {
      console.log(
        `turn ${t.humanPostId}: ${t.outcome}; replies: ${t.replies?.length ?? 0}; trace ${t.traceChars} chars`
      );
      for (const m of t.replies ?? []) console.log(`--- reply ---\n${m.slice(0, 1500)}`);
    }
    if (r.notes.length) console.log(`notes: ${r.notes.join(' | ')}`);
  }
} else if (verb === 'resume') {
  const task = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, `${rest[0]}.json`), 'utf-8'));
  const pairs = rest[1].split(',').map((pair) => pair.split(':'));
  const records = await Promise.all(
    pairs.map(([key, postId]) => resumeTask(task.id, task, key, postId, Number(rest[2] ?? 0)))
  );
  appendRun(records);
  for (const r of records) {
    console.log(`\n=== ${r.model} ===`);
    for (const t of r.turns) {
      console.log(
        `turn ${t.humanPostId}: ${t.outcome}; replies: ${t.replies?.length ?? 0}; trace ${t.traceChars} chars`
      );
      for (const m of t.replies ?? []) console.log(`--- reply ---\n${m.slice(0, 1500)}`);
    }
    if (r.notes.length) console.log(`notes: ${r.notes.join(' | ')}`);
  }
} else if (verb === 'deny') {
  console.log(dialog(rest[0], 'reason', 'reason', rest[1]));
} else if (verb === 'press') {
  console.log(JSON.stringify(await pressButton(rest[0], rest[1])).slice(0, 200));
} else if (verb === 'get') {
  const p = await api('GET', `/posts/${rest[0]}`);
  console.log(
    p.message
      .split('\n')
      .slice(0, Number(rest[1] ?? 60))
      .join('\n')
  );
} else if (verb === 'cmd') {
  const response = await command(AGENTS[rest[0]].channel, rest[1]);
  console.log(response?.text ?? JSON.stringify(response));
} else if (verb === 'post') {
  const p = await post(AGENTS[rest[0]].channel, rest[1]);
  console.log(p.id);
} else if (verb === 'trace') {
  console.log(await saveTrace(AGENTS[rest[0]], rest[1], rest[2]));
} else if (verb === 'posts') {
  const agent = AGENTS[rest[0]];
  const since = Date.now() - Number(rest[1] ?? 30) * 60_000;
  for (const p of await postsSince(agent.channel, since)) {
    const who = Object.values(AGENTS).find((a) => a.id === p.user_id)?.username ?? p.user_id;
    console.log(
      `${new Date(p.create_at).toISOString().slice(11, 19)} ${p.id} ${who} type=${JSON.stringify(p.type)} root=${p.root_id || '-'} props=${Object.keys(p.props ?? {}).join(',') || '-'} files=${(p.file_ids ?? []).length} msg(${p.message.length})=${JSON.stringify(p.message.slice(0, 70))}`
    );
  }
} else {
  console.error(
    'usage: driver.mjs login | task <id> [--agents a,b] | cmd <agent> <command> | post <agent> <text> | trace <agent> <postId> <file>'
  );
  process.exit(1);
}
