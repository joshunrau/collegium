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
  },
  ds2: { username: 'tester-ds2', channelName: 'bakeoff-team' }
};
const SYSTEM_BOT = { username: 'orchestrator', id: 'jyf4abkjcjfkmy5ohk7szepf9o' };
const QUIET_MS = 40_000;
const channelIds = new Map();

// An agent provisioned after this file was written has no id here; look it and its channel up once.
async function resolveIds() {
  const missing = Object.values(AGENTS).filter((a) => !a.id);
  if (missing.length > 0) {
    const users = await api(
      'POST',
      '/users/usernames',
      missing.map((a) => a.username)
    );
    for (const a of missing) a.id = users.find((u) => u.username === a.username)?.id;
  }
  for (const a of Object.values(AGENTS)) {
    if (!a.channel) a.channel = await channelIdByName(a.channelName);
  }
}

// `dm:<agentKey>` is the direct channel between the driver's account and that agent.
async function channelIdByName(name) {
  if (!channelIds.has(name)) {
    if (name.startsWith('dm:')) {
      const me = await api('GET', '/users/me');
      const channel = await api('POST', '/channels/direct', [me.id, AGENTS[name.slice(3)].id]);
      channelIds.set(name, channel.id);
    } else {
      const channel = await api('GET', `/teams/${TEAM}/channels/name/${name}`);
      channelIds.set(name, channel.id);
    }
  }
  return channelIds.get(name);
}
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

async function api(method, route, body, attempt = 1) {
  let response;
  try {
    response = await fetch(`${MM}/api/v4${route}`, {
      method,
      headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    // A stalled or reset connection is the driver's problem, never the run's: retry reads, and
    // retry a post only after a poll failed to show it (the caller re-posting would duplicate it).
    if (attempt >= 4 || method !== 'GET') throw error;
    log('api', `${method} ${route} failed (${error.cause?.code ?? error.name}); retry ${attempt}`);
    await sleep(5_000 * attempt);
    return api(method, route, body, attempt + 1);
  }
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

// The trace command answers only in the channel the turn ran in (§8.2), so the task's channel
// is passed, not the agent's default one.
async function saveTrace(agent, postId, file, channelId = agent.channel) {
  const response = await command(channelId, `/collegium trace ${postId}`);
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
    const option = actions.find((a) => a.name === answer) ?? actions.find((a) => a.name.startsWith(answer));
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

// Watches one channel from `sinceMs` for the turns of every agent in `watch` (a chain of hand-offs
// is several turns by several agents); settles when every watched agent's newest status post is
// terminal and nothing has changed for QUIET_MS, so a colleague's turn that starts a few seconds
// after the first one ends is still caught.
async function waitTurn(tag, watch, channelId, sinceMs, queue, record, timeoutMs = TURN_TIMEOUT_MS) {
  const handled = new Set();
  const started = Date.now();
  const watchedIds = new Set(watch.map((a) => a.id));
  const ownedBy = (p) => watchedIds.has(p.user_id);
  while (true) {
    // `since` also returns posts edited after that instant, so the previous turn's status post,
    // edited to its terminal marker moments before this task was posted, would be matched here.
    const posts = (await postsSince(channelId, sinceMs)).filter((p) => p.create_at >= sinceMs + 1000);
    for (const p of posts) {
      if (isPrompt(p) && ownedBy(p) && !handled.has(p.id)) {
        handled.add(p.id);
        try {
          await decidePrompt(tag, watch[0], p, queue, record);
        } catch (error) {
          record.notes.push(`decision failed on ${p.id} at ${now()}: ${String(error).slice(0, 200)}`);
          log(tag, `decision failed on ${p.id}: ${String(error).slice(0, 120)}`);
        }
      }
    }
    const statuses = posts.filter((p) => ownedBy(p) && STATUS_RE.test(p.message));
    const status = statuses.at(-1);
    const replies = posts.filter(
      (p) =>
        ownedBy(p) &&
        p.message.length > 0 &&
        !STATUS_RE.test(p.message) &&
        !DECISION_RE.test(p.message) &&
        !startsWithAny(p.message, PROMPT)
    );
    const systemPosts = posts.filter((p) => p.user_id === SYSTEM_BOT.id && p.message.length > 0);
    const newestOf = (a) => statuses.filter((p) => p.user_id === a.id).at(-1);
    // A colleague addressed by a watched post owes a turn; its status post can lag the mention by
    // minutes (the first model call posts nothing), so wait for it before calling the chain done.
    const owed = watch.filter((a) =>
      posts.some(
        (p) =>
          (ownedBy(p) || p.user_id === SYSTEM_BOT.id || !p.user_id.startsWith('_')) &&
          p.message.includes(`@${a.username}`) &&
          !(newestOf(a) && newestOf(a).create_at > p.create_at)
      )
    );
    const allTerminal =
      statuses.length > 0 &&
      owed.length === 0 &&
      watch.every((a) => !newestOf(a) || startsWithAny(newestOf(a).message, TERMINAL));
    const newest = Math.max(0, ...posts.map((p) => Math.max(p.create_at, p.update_at)));
    const quietFor = Date.now() - newest;
    const pending = posts.some((p) => isPrompt(p) && !handled.has(p.id));
    if (allTerminal && quietFor > QUIET_MS && !pending) {
      return { status, statuses, replies, systemPosts, outcome: status.message.split('\n')[0] };
    }
    if (statuses.length === 0 && (replies.length > 0 || systemPosts.length > 0) && quietFor > 90_000 && !pending) {
      record.notes.push(
        `settled with no status post at ${now()} (${replies.length} replies, ${systemPosts.length} system posts)`
      );
      return { status, statuses, replies, systemPosts, outcome: 'settled-without-status' };
    }
    if (Date.now() - started > timeoutMs) {
      return { status, statuses, replies, systemPosts, outcome: 'timeout' };
    }
    await sleep(POLL_MS);
  }
}

const exec = (cmd) =>
  spawnSync('bash', ['-lc', cmd], { encoding: 'utf-8', env: { ...process.env, RUN_DIR, TASKS_DIR } });

// A task may name a `channel` (by name) other than the agent's own, and `watch` (agent keys) whose
// turns all belong to the task, for a hand-off chain. Steps beyond post/approval/ask/command:
// `exec` runs a local shell command (a webhook call, a mail send); `watch` posts nothing and waits
// for the next turn in the channel (a trigger announcement); a `post` with `noWait` returns at once
// and `delayMs` sleeps before it, for concurrency probes.
async function runTask(taskId, task, key) {
  const agent = AGENTS[key];
  const tag = key;
  const channelId = task.channel ? await channelIdByName(task.channel) : agent.channel;
  const watch = (task.watch ?? [key]).map((k) => AGENTS[k]);
  const substitute = (text) =>
    text
      .replaceAll('{agent}', agent.username)
      .replaceAll('{FIX}', FIX)
      .replaceAll('{channelId}', channelId)
      .replaceAll('{MAILBOX}', process.env.MAILBOX ?? '')
      .replaceAll('{TOKEN}', process.env.TRIGGER_TOKEN ?? '');
  const record = {
    task: taskId,
    agent: agent.username,
    model: key,
    channel: channelId,
    watch: watch.map((a) => a.username),
    startedAt: now(),
    turns: [],
    promptPostIds: [],
    decisions: [],
    notes: []
  };
  const steps = [...task.steps];
  let lastHumanCreateAt;
  while (steps.length > 0) {
    const step = steps.shift();
    if (step.delayMs) await sleep(step.delayMs);
    if (step.command) {
      const response = await command(channelId, substitute(step.command));
      record.notes.push(`command ${substitute(step.command)} -> ${(response?.text ?? '').slice(0, 300)}`);
      log(tag, `ran ${substitute(step.command)}`);
      await sleep(3000);
      continue;
    }
    if (step.exec) {
      const result = exec(substitute(step.exec));
      record.notes.push(
        `exec ${step.exec.slice(0, 80)} -> ${result.status}: ${(result.stdout + result.stderr).trim().slice(0, 300)}`
      );
      log(tag, `exec ${step.exec.slice(0, 60)} -> ${result.status}`);
      continue;
    }
    if (!step.post && !step.watch) continue;
    const queue = [];
    while (steps.length > 0 && (steps[0].approval || steps[0].ask)) queue.push(steps.shift());
    let human;
    if (step.post) {
      human = await post(channelId, substitute(step.post));
      lastHumanCreateAt = human.create_at;
      log(tag, `posted ${human.id}: ${substitute(step.post).slice(0, 80)}`);
    }
    const turn = {
      humanPostId: human?.id,
      watchLabel: step.watch,
      postedAt: now(),
      statusPostIds: [],
      replyPostIds: [],
      systemPostIds: [],
      outcome: undefined,
      endedAt: undefined,
      traceChars: 0
    };
    record.turns.push(turn);
    if (step.noWait) {
      turn.outcome = 'not-waited';
      continue;
    }
    // A watch after a post the driver did not wait for still belongs to that post's turn.
    const sinceMs =
      (human?.create_at ??
        (step.watch && steps.length < task.steps.length ? lastHumanCreateAt : undefined) ??
        Date.now()) - 1000;
    lastHumanCreateAt = undefined;
    const result = await waitTurn(tag, watch, channelId, sinceMs, queue, record, step.timeoutMs);
    turn.statusPostId = result.status?.id;
    turn.statusPostIds = result.statuses.map((p) => p.id);
    turn.replyPostIds = result.replies.map((p) => p.id);
    turn.replies = result.replies.map((p) => `@${watch.find((a) => a.id === p.user_id)?.username}: ${p.message}`);
    turn.systemPostIds = result.systemPosts.map((p) => p.id);
    turn.systemPosts = result.systemPosts.map((p) => p.message);
    turn.outcome = result.outcome;
    turn.endedAt = now();
    log(
      tag,
      `turn ended: ${result.outcome} with ${result.statuses.length} status, ${result.replies.length} reply, ${result.systemPosts.length} system post(s)`
    );
    for (const [i, s] of result.statuses.entries()) {
      const owner = watch.find((a) => a.id === s.user_id);
      const file = path.join(
        RUN_DIR,
        'traces',
        `${taskId}-${key}-${record.turns.length}${result.statuses.length > 1 ? `-${i + 1}-${owner?.username}` : ''}.md`
      );
      turn.traceChars += await saveTrace(owner ?? agent, s.id, file, channelId);
    }
    if (turn.traceChars) log(tag, `trace ${turn.traceChars} chars`);
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
  const result = await waitTurn(key, [agent], agent.channel, human.create_at - 1000, queue, record);
  turn.statusPostId = result.status?.id;
  turn.replyPostIds = result.replies.map((p) => p.id);
  turn.replies = result.replies.map((p) => p.message);
  turn.outcome = result.outcome;
  turn.endedAt = now();
  log(key, `turn ended: ${result.outcome} with ${result.replies.length} reply post(s)`);
  const target = turn.statusPostId ?? turn.replyPostIds[0];
  if (target) {
    const file = path.join(RUN_DIR, 'traces', `${taskId}-${key}-${record.turns.length}.md`);
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
if (verb !== 'login') await resolveIds();
if (verb === 'login') {
  await login();
} else if (verb === 'task') {
  const taskFile = rest[0].includes('/') ? rest[0] : path.join(TASKS_DIR, `${rest[0]}.json`);
  const task = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
  const keys = (
    rest.includes('--agents') ? rest[rest.indexOf('--agents') + 1] : (task.agents?.join(',') ?? 'ds,glm,luna')
  ).split(',');
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
