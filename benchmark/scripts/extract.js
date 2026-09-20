/// <reference types="node" />

// @ts-check

/**
 * Turns a snapshot of the stack's SQLite into per-task artifacts a reader can judge from, so no
 * trace ever has to pass through a model's context whole. Reads run.json, which the driving step
 * wrote (which Mattermost channel each task ran in, and the tier), and writes one directory per
 * task holding the turns with their metrics, every event in order, the posts, the approvals and
 * asks, the work units, the triggers and the memories, plus a summary of the numbers.
 *
 *   node benchmark/scripts/extract.js --db <snapshot.db> --run <run.json> --out <results dir>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    db: { type: 'string' },
    out: { type: 'string' },
    run: { type: 'string' }
  }
});
if (!values.db || !values.run || !values.out) {
  console.error('usage: extract.js --db <snapshot.db> --run <run.json> --out <results dir>');
  process.exit(1);
}

const run = JSON.parse(fs.readFileSync(values.run, 'utf-8'));
const db = new DatabaseSync(values.db, { readOnly: true });

const JSON_COLUMNS = new Set(['args', 'attachments', 'options', 'payload', 'reference']);
const DATE_COLUMNS = new Set([
  'answeredAt',
  'closedAt',
  'createdAt',
  'decidedAt',
  'endedAt',
  'lastEnqueuedAt',
  'lastUsedAt',
  'observedAt',
  'postedAt',
  'resolvedAt',
  'startedAt',
  'updatedAt'
]);

/** @param {Record<string, unknown>} row */
function normalize(row) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null) {
      out[key] = null;
    } else if (JSON_COLUMNS.has(key) && typeof value === 'string') {
      out[key] = JSON.parse(value);
    } else if (DATE_COLUMNS.has(key) && typeof value === 'number') {
      out[key] = new Date(value).toISOString();
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * @param {string} sql
 * @param {unknown[]} params
 */
function rows(sql, params) {
  return /** @type {Record<string, unknown>[]} */ (db.prepare(sql).all(...params)).map(normalize);
}

/** @param {readonly string[]} ids */
function placeholders(ids) {
  return ids.map(() => '?').join(', ');
}

/**
 * @param {string} dir
 * @param {string} name
 * @param {unknown} data
 */
function write(dir, name, data) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
}

/** @param {unknown} value */
function asNumber(value) {
  return typeof value === 'number' ? value : 0;
}

const summaries = [];
for (const [taskId, entry] of Object.entries(run.tasks)) {
  const channelIds = Object.values(entry.channels ?? {}).filter((id) => typeof id === 'string');
  if (channelIds.length === 0) {
    continue;
  }
  const marks = placeholders(channelIds);
  const turns = rows(`SELECT * FROM "Turn" WHERE "channelId" IN (${marks}) ORDER BY "startedAt"`, channelIds);
  const turnIds = turns.map((turn) => /** @type {string} */ (turn.id));
  const turnMarks = placeholders(turnIds);
  const events =
    turnIds.length === 0
      ? []
      : rows(`SELECT * FROM "TurnEvent" WHERE "turnId" IN (${turnMarks}) ORDER BY "turnId", "sequence"`, turnIds);
  const posts = rows(`SELECT * FROM "Post" WHERE "channelId" IN (${marks}) ORDER BY "createdAt"`, channelIds);
  const approvals =
    turnIds.length === 0
      ? []
      : rows(`SELECT * FROM "Approval" WHERE "turnId" IN (${turnMarks}) ORDER BY "createdAt"`, turnIds);
  const asks =
    turnIds.length === 0
      ? []
      : rows(`SELECT * FROM "Ask" WHERE "turnId" IN (${turnMarks}) ORDER BY "createdAt"`, turnIds);
  const units = rows(`SELECT * FROM "WorkUnit" WHERE "channelId" IN (${marks}) ORDER BY "createdAt"`, channelIds);
  const triggers = rows(
    `SELECT * FROM "Trigger" WHERE "targetChannelId" IN (${marks}) ORDER BY "createdAt"`,
    channelIds
  );
  const postIds = posts.map((post) => /** @type {string} */ (post.id));
  const memories =
    postIds.length === 0
      ? []
      : rows(`SELECT * FROM "Memory" WHERE "originPostId" IN (${placeholders(postIds)}) ORDER BY "createdAt"`, postIds);
  const agentUsernames = [...new Set(turns.map((turn) => /** @type {string} */ (turn.agentUsername)))];
  const memoriesHeld =
    agentUsernames.length === 0
      ? []
      : rows(
          `SELECT * FROM "Memory" WHERE "agentUsername" IN (${placeholders(agentUsernames)}) ORDER BY "createdAt"`,
          agentUsernames
        );

  const replies = posts.filter((post) => post.authorKind === 'agent' && post.kind === 'reply');
  const summary = {
    agents: agentUsernames,
    approvals: approvals.map((approval) => ({
      status: approval.status,
      tool: [approval.toolNamespace, approval.toolName]
    })),
    asks: asks.length,
    channels: entry.channels,
    memoriesWritten: memories.length,
    replyPosts: replies.length,
    task: taskId,
    tier: run.tier,
    totals: {
      actionCount: turns.reduce((sum, turn) => sum + asNumber(turn.actionCount), 0),
      completionTokens: turns.reduce((sum, turn) => sum + asNumber(turn.completionTokens), 0),
      costUsd: turns.reduce((sum, turn) => sum + asNumber(turn.costUsd), 0),
      promptTokens: turns.reduce((sum, turn) => sum + asNumber(turn.promptTokens), 0),
      reasoningTokens: turns.reduce((sum, turn) => sum + asNumber(turn.reasoningTokens), 0)
    },
    triggers: triggers.map((trigger) => trigger.status),
    turns: turns.map((turn) => ({
      actionCount: turn.actionCount,
      agent: turn.agentUsername,
      cachedPromptTokens: turn.cachedPromptTokens,
      completionTokens: turn.completionTokens,
      costUsd: turn.costUsd,
      durationMs:
        typeof turn.startedAt === 'string' && typeof turn.endedAt === 'string'
          ? Date.parse(turn.endedAt) - Date.parse(turn.startedAt)
          : null,
      id: turn.id,
      promptTokens: turn.promptTokens,
      reasoningTokens: turn.reasoningTokens,
      status: turn.status
    })),
    units: units.map((unit) => ({ assignee: unit.assigneeUsername, creator: unit.creatorUsername, state: unit.state }))
  };

  const dir = path.join(values.out, 'tasks', taskId);
  write(dir, 'turns.json', turns);
  write(dir, 'events.json', events);
  write(dir, 'posts.json', posts);
  write(dir, 'approvals.json', approvals);
  write(dir, 'asks.json', asks);
  write(dir, 'units.json', units);
  write(dir, 'triggers.json', triggers);
  write(dir, 'memories.json', { heldByAgents: memoriesHeld, writtenHere: memories });
  write(dir, 'summary.json', summary);
  summaries.push(summary);
}

write(values.out, 'summary.json', { run: { ...run, tasks: undefined }, tasks: summaries });
db.close();
process.stdout.write(`${`extracted ${summaries.length} tasks into ${values.out}`}\n`);
