// Slices the extracted store into one artifact directory per task and agent, by time window from run.json.
//   node slice.mjs --raw raw.json --run run.json --out artifacts/
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { raw: { type: 'string' }, run: { type: 'string' }, out: { type: 'string' }, tasks: { type: 'string' } }
});
const raw = JSON.parse(fs.readFileSync(values.raw, 'utf-8'));
const run = JSON.parse(fs.readFileSync(values.run, 'utf-8'));
const only = values.tasks?.split(',');
const JSON_COLUMNS = new Set(['args', 'attachments', 'options', 'payload', 'reference']);
const parse = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, JSON_COLUMNS.has(k) && typeof v === 'string' ? JSON.parse(v) : v])
  );
const ms = (iso) => new Date(iso).getTime();
const write = (dir, name, data) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
};
const sum = (rows, key) => rows.reduce((total, row) => total + (typeof row[key] === 'number' ? row[key] : 0), 0);

for (const entry of run.entries) {
  if (only && !only.includes(entry.task)) continue;
  const from = ms(entry.startedAt) - 5_000;
  const to = ms(entry.endedAt) + 5_000;
  const inWindow = (row, key) => {
    const t = typeof row[key] === 'number' ? row[key] : ms(row[key]);
    return t >= from && t <= to;
  };
  const humanPostIds = new Set((entry.turns ?? []).map((t) => t.humanPostId));
  const byTrigger = raw.turns.filter((t) => t.channelId === entry.channel && humanPostIds.has(t.triggeringPostId));
  const turns = (
    byTrigger.length > 0
      ? byTrigger
      : raw.turns.filter((t) => t.channelId === entry.channel && inWindow(t, 'startedAt'))
  ).map(parse);
  const ids = new Set(turns.map((t) => t.id));
  const events = raw.events.filter((e) => ids.has(e.turnId)).map(parse);
  const posts = raw.posts.filter((p) => p.channelId === entry.channel && inWindow(p, 'createdAt')).map(parse);
  const approvals = raw.approvals.filter((a) => ids.has(a.turnId)).map(parse);
  const asks = raw.asks.filter((a) => ids.has(a.turnId)).map(parse);
  const memories = raw.memories.filter((m) => m.agentUsername === entry.agent && inWindow(m, 'createdAt')).map(parse);
  const dir = path.join(values.out, entry.task, entry.model);
  write(dir, 'turns.json', turns);
  write(dir, 'events.json', events);
  write(dir, 'posts.json', posts);
  write(dir, 'approvals.json', approvals);
  write(dir, 'asks.json', asks);
  write(dir, 'memories.json', memories);
  write(dir, 'driver.json', entry);
  write(dir, 'summary.json', {
    task: entry.task,
    agent: entry.agent,
    model: turns[0]?.modelName ?? null,
    turns: turns.length,
    statuses: turns.map((t) => t.status),
    actionCount: sum(turns, 'actionCount'),
    promptTokens: sum(turns, 'promptTokens'),
    cachedPromptTokens: sum(turns, 'cachedPromptTokens'),
    completionTokens: sum(turns, 'completionTokens'),
    reasoningTokens: sum(turns, 'reasoningTokens'),
    costUsd: sum(turns, 'costUsd'),
    durationMs: turns.reduce(
      (total, t) => total + (t.endedAt ? Date.parse(t.endedAt) - Date.parse(t.startedAt) : 0),
      0
    ),
    events: events.length,
    toolCalls: events.filter((e) => e.kind === 'tool_result').length,
    memoriesWritten: events.filter((e) => e.kind === 'record_written').length
  });
  console.log(`${entry.task}/${entry.model}: ${turns.length} turn(s), ${events.length} events, ${posts.length} posts`);
}
