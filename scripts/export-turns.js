/// <reference types="node" />

// @ts-check

/**
 * Exports turns and their posts from a running deployment, for offline analysis.
 *
 * Two phases, because a single dump cannot produce a representative sample: `inventory` reads
 * channel history and writes one manifest row per turn without fetching a single trace, you curate
 * that file, and `export` pays for traces only on the rows you kept.
 *
 * Nothing here knows anything about a particular deployment: the server, team, channels and agents
 * are all arguments, and credentials are read from the environment so they never reach shell
 * history or the process table.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';

/**
 * @typedef {object} Session
 * @property {string | undefined} token bearer token once authenticated
 * @property {string} url deployment origin, without a trailing slash
 */

/**
 * @typedef {object} MattermostPost the fields of a post this tool reads
 * @property {number} create_at
 * @property {string} id
 * @property {string} message
 * @property {number} [update_at]
 * @property {string} user_id
 */

/**
 * @typedef {object} MattermostPostPage
 * @property {string[]} [order] post ids, newest first
 * @property {Record<string, MattermostPost>} posts
 */

/**
 * @typedef {object} MattermostNamed a team or channel, reduced to what resolution needs
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {object} MattermostUser
 * @property {string} id
 * @property {string} username
 */

/**
 * @typedef {object} MattermostCommandResponse
 * @property {string} [message]
 * @property {string} [text] the ephemeral answer a slash command returns
 */

/** @typedef {'done' | 'running' | 'stopped'} TurnStatus */

/**
 * @typedef {object} ChannelRef
 * @property {string} handle
 * @property {string} id
 */

/**
 * One turn as `inventory` can see it — everything here comes from the status post, so it costs no
 * trace call.
 *
 * @typedef {object} ManifestRow
 * @property {string | undefined} agent the bot whose turn it was
 * @property {string} channel channel handle
 * @property {number | undefined} durationMs the turn's own duration as the framework reports it,
 *   undefined where the status post carries none — never inferred from the post's timestamps
 * @property {boolean} include set true to select the row for export
 * @property {string} startedAt ISO 8601; the status post's creation, which trails the turn's start
 * @property {string} statusPostId what `/collegium trace` takes
 * @property {number} statusPostSpanMs create_at to last edit — the post's lifetime, not the turn's
 * @property {TurnStatus | undefined} status
 * @property {string} summary the status post verbatim — the generic handle for selecting a turn
 * @property {Record<string, number>} toolCalls tool name to call count, as the summary reports them
 */

/**
 * A manifest row after `export` has read the trace header, which is the only place the turn id,
 * model, depth and chain appear.
 *
 * @typedef {ManifestRow & {
 *   chain: number | undefined,
 *   depth: number | undefined,
 *   model: string | undefined,
 *   outcome: string | undefined,
 *   traceChars: number,
 *   tracePath: string,
 *   turnId: string | undefined
 * }} ExportedRow
 */

/**
 * @typedef {object} RunIndex
 * @property {Record<string, {posts: number, turns: number}>} [channels]
 * @property {string} [exportedAt]
 * @property {number} [exportedTurns]
 * @property {string} generatedAt
 * @property {'export' | 'inventory'} phase
 * @property {string} team
 * @property {string} toolVersion
 * @property {string} url
 * @property {{since: string, until: string}} [window]
 */

/**
 * @typedef {object} CliValues
 * @property {string[]} [agent]
 * @property {boolean} [all]
 * @property {string[]} [channel]
 * @property {string} [delay]
 * @property {boolean} [help]
 * @property {string} [manifest]
 * @property {string} [out]
 * @property {string} [since]
 * @property {string} [team]
 * @property {string} [until]
 * @property {string} [url]
 */

const TOOL_VERSION = '1.0.0';

/** the markers the framework writes at the head of a status post, and the status each implies */
const STATUS_MARKERS = /** @type {const} */ ([
  { marker: '⏳', status: 'running' },
  { marker: '✅', status: 'done' },
  { marker: '⚠️', status: 'stopped' }
]);

/** one `→ \`namespace::tool …\`` line of a status post's tool list */
const TOOL_CALL_PATTERN = /^→\s+`([a-z][\w-]*::[\w-]+)/gm;

/**
 * The parenthesised duration of a terminal status marker, as in `✅ _done (6m 12s)_`. The post's
 * own timestamps do not measure the turn — it is created after the turn starts and its last edit is
 * not the turn's end — so this is the only honest source for how long a turn ran.
 */
const REPORTED_DURATION_PATTERN = /\((?:(?<hours>\d+)h\s*)?(?:(?<minutes>\d+)m\s*)?(?:(?<seconds>\d+)s)?\)/;

/** `Trace for turn {id} ({agent} on {model}, {outcome}, depth {n}, chain {n}):` */
const TRACE_HEADER_PATTERN =
  /^Trace for turn (?<turnId>\S+) \((?<agent>\S+) on (?<model>[^,]+), (?<outcome>[^,]+), depth (?<depth>\d+), chain (?<chain>\d+)\)/;

const MAX_POSTS_PER_PAGE = 200;
const REQUEST_TIMEOUT_MS = 60_000;
const REQUEST_RETRIES = 3;

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  process.stderr.write(`export-turns: ${message}\n`);
  process.exit(1);
}

/** @returns {string} */
function usage() {
  return [
    'Usage:',
    '  node scripts/export-turns.js inventory --url <url> --team <team> --channel <name> [--channel <name>…]',
    '                                         --since <iso> [--until <iso>] [--agent <name>…] --out <dir>',
    '  node scripts/export-turns.js export --manifest <path> [--out <dir>] [--all] [--delay <ms>]',
    '',
    'Credentials come from the environment, never from a flag:',
    '  COLLEGIUM_MATTERMOST_TOKEN, or COLLEGIUM_MATTERMOST_EMAIL + COLLEGIUM_MATTERMOST_PASSWORD',
    '  COLLEGIUM_MATTERMOST_URL and COLLEGIUM_MATTERMOST_TEAM stand in for --url and --team.',
    '',
    'Curate between the phases: set "include": true on the manifest rows you want, or pass --all.'
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/* transport                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One request against the Mattermost API. A deployment reached over a slow link can stall well past
 * any sane wait, so every call is bounded and retried rather than left to hang the export.
 *
 * The body is returned untyped: this is a perimeter, and each caller narrows it to the typedef it
 * expects rather than this function pretending to know.
 *
 * @param {Session} session
 * @param {'GET' | 'POST'} method
 * @param {string} endpoint path below `/api/v4`
 * @param {unknown} [body]
 * @returns {Promise<{body: any, headers: Headers}>}
 */
async function request(session, method, endpoint, body) {
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json' };
  if (session.token !== undefined) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  /** @type {unknown} */
  let lastError;
  for (let attempt = 1; attempt <= REQUEST_RETRIES; attempt++) {
    try {
      const response = await fetch(`${session.url}/api/v4${endpoint}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers,
        method,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(`HTTP ${response.status} on ${method} ${endpoint}: ${detail}`);
      }
      return { body: await response.json(), headers: response.headers };
    } catch (error) {
      lastError = error;
      if (attempt < REQUEST_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
}

/**
 * @param {string} url
 * @returns {Promise<Session>}
 */
async function authenticate(url) {
  const token = process.env.COLLEGIUM_MATTERMOST_TOKEN;
  if (token !== undefined && token !== '') {
    return { token, url };
  }
  const login_id = process.env.COLLEGIUM_MATTERMOST_EMAIL;
  const password = process.env.COLLEGIUM_MATTERMOST_PASSWORD;
  if (login_id === undefined || password === undefined) {
    fail('set COLLEGIUM_MATTERMOST_TOKEN, or COLLEGIUM_MATTERMOST_EMAIL and COLLEGIUM_MATTERMOST_PASSWORD');
  }
  // the session token comes back in a header; the body holds the user record only
  const { headers } = await request({ token: undefined, url }, 'POST', '/users/login', { login_id, password });
  const issued = headers.get('token');
  if (issued === null) {
    fail('login succeeded but returned no Token header');
  }
  return { token: issued, url };
}

/**
 * @param {Session} session
 * @param {string} teamName
 * @param {readonly string[]} handles
 * @returns {Promise<ChannelRef[]>}
 */
async function resolveChannels(session, teamName, handles) {
  /** @type {MattermostNamed[]} */
  const teams = (await request(session, 'GET', '/users/me/teams')).body;
  const team = teams.find((candidate) => candidate.name === teamName);
  if (team === undefined) {
    fail(`no team "${teamName}" among ${teams.map((candidate) => candidate.name).join(', ') || '(none)'}`);
  }
  /** @type {MattermostNamed[]} */
  const channels = (await request(session, 'GET', `/users/me/teams/${team.id}/channels`)).body;
  const byName = new Map(channels.map((channel) => [channel.name, channel.id]));
  return handles.map((handle) => {
    const id = byName.get(handle);
    if (id === undefined) {
      fail(`channel "${handle}" is not one this account is in`);
    }
    return { handle, id };
  });
}

/**
 * Every post in [since, until), paged back until the window is covered.
 *
 * @param {Session} session
 * @param {string} channelId
 * @param {number} since epoch ms, inclusive
 * @param {number} until epoch ms, exclusive
 * @returns {Promise<MattermostPost[]>}
 */
async function readPostWindow(session, channelId, since, until) {
  /** @type {MattermostPost[]} */
  const collected = [];
  for (let page = 0; ; page++) {
    /** @type {MattermostPostPage} */
    const body = (
      await request(session, 'GET', `/channels/${channelId}/posts?per_page=${MAX_POSTS_PER_PAGE}&page=${page}`)
    ).body;
    const ordered = (body.order ?? []).map((id) => body.posts[id]);
    if (ordered.length === 0) {
      return collected;
    }
    for (const post of ordered) {
      if (post.create_at >= since && post.create_at < until) {
        collected.push(post);
      }
    }
    const oldest = ordered[ordered.length - 1];
    if (oldest.create_at < since) {
      return collected;
    }
  }
}

/**
 * @param {Session} session
 * @param {readonly string[]} userIds
 * @returns {Promise<Map<string, string>>} user id to username
 */
async function resolveUsernames(session, userIds) {
  /** @type {Map<string, string>} */
  const names = new Map();
  const unique = [...new Set(userIds)];
  for (let index = 0; index < unique.length; index += 100) {
    /** @type {MattermostUser[]} */
    const users = (await request(session, 'POST', '/users/ids', unique.slice(index, index + 100))).body;
    for (const user of users) {
      names.set(user.id, user.username);
    }
  }
  return names;
}

/**
 * @param {Session} session
 * @param {string} channelId
 * @param {string} command
 * @returns {Promise<string>} the ephemeral answer, which never appears in the channel
 */
async function runSlashCommand(session, channelId, command) {
  /** @type {MattermostCommandResponse} */
  const body = (await request(session, 'POST', '/commands/execute', { channel_id: channelId, command })).body;
  return body.text ?? body.message ?? '';
}

/* -------------------------------------------------------------------------- */
/* inventory                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} message
 * @returns {TurnStatus | undefined} undefined where the post is not a status post at all
 */
function readStatus(message) {
  const head = message.trimStart();
  return STATUS_MARKERS.find((candidate) => head.startsWith(candidate.marker))?.status;
}

/**
 * @param {string} message
 * @returns {number | undefined} milliseconds, or undefined where no duration is reported
 */
function readReportedDuration(message) {
  const groups = REPORTED_DURATION_PATTERN.exec(message.split('\n')[0])?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const { hours, minutes, seconds } = groups;
  if (hours === undefined && minutes === undefined && seconds === undefined) {
    return undefined;
  }
  return ((Number(hours ?? 0) * 60 + Number(minutes ?? 0)) * 60 + Number(seconds ?? 0)) * 1000;
}

/**
 * @param {string} message
 * @returns {Record<string, number>}
 */
function countToolCalls(message) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const [, name] of message.matchAll(TOOL_CALL_PATTERN)) {
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

/**
 * The status post is the framework's own summary of a turn, so it is what inventory can read
 * cheaply — and `summary` is kept verbatim because it is the only generic handle for selecting a
 * turn by what it touched. Anything a tool put in it is searchable without this script knowing what
 * any tool means.
 *
 * @param {MattermostPost} post
 * @param {string} channel
 * @param {string | undefined} username
 * @returns {ManifestRow}
 */
function toManifestRow(post, channel, username) {
  return {
    agent: username,
    channel,
    durationMs: readReportedDuration(post.message),
    include: false,
    startedAt: new Date(post.create_at).toISOString(),
    status: readStatus(post.message),
    statusPostId: post.id,
    statusPostSpanMs: (post.update_at ?? post.create_at) - post.create_at,
    summary: post.message,
    toolCalls: countToolCalls(post.message)
  };
}

/**
 * @param {CliValues} options
 * @returns {Promise<void>}
 */
async function runInventory(options) {
  const url = options.url ?? process.env.COLLEGIUM_MATTERMOST_URL;
  const team = options.team ?? process.env.COLLEGIUM_MATTERMOST_TEAM;
  if (url === undefined || team === undefined) {
    fail('--url and --team are required (or COLLEGIUM_MATTERMOST_URL and COLLEGIUM_MATTERMOST_TEAM)');
  }
  if (options.channel === undefined || options.channel.length === 0) {
    fail('at least one --channel is required');
  }
  const out = options.out;
  if (out === undefined) {
    fail('--out is required');
  }
  const since = Date.parse(options.since ?? '');
  const until = options.until === undefined ? Date.now() : Date.parse(options.until);
  if (Number.isNaN(since) || Number.isNaN(until)) {
    fail('--since and --until must parse as dates');
  }

  const session = await authenticate(url.replace(/\/$/, ''));
  const channels = await resolveChannels(session, team, options.channel);
  const agents = options.agent !== undefined && options.agent.length > 0 ? new Set(options.agent) : undefined;

  fs.mkdirSync(path.join(out, 'posts'), { recursive: true });
  /** @type {ManifestRow[]} */
  const rows = [];
  /** @type {Record<string, {posts: number, turns: number}>} */
  const counts = {};

  for (const channel of channels) {
    const posts = await readPostWindow(session, channel.id, since, until);
    const usernames = await resolveUsernames(
      session,
      posts.map((post) => post.user_id)
    );
    fs.writeFileSync(
      path.join(out, 'posts', `${channel.handle}.json`),
      JSON.stringify(
        posts.map((post) => ({ ...post, username: usernames.get(post.user_id) })),
        undefined,
        2
      )
    );
    const kept = posts
      .filter((post) => readStatus(post.message) !== undefined)
      .map((post) => toManifestRow(post, channel.handle, usernames.get(post.user_id)))
      .filter((row) => agents === undefined || (row.agent !== undefined && agents.has(row.agent)));
    rows.push(...kept);
    counts[channel.handle] = { posts: posts.length, turns: kept.length };
    process.stdout.write(`${channel.handle}: ${posts.length} posts, ${kept.length} turns\n`);
  }

  rows.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  writeJsonLines(path.join(out, 'manifest.jsonl'), rows);
  /** @type {RunIndex} */
  const index = {
    channels: counts,
    generatedAt: new Date().toISOString(),
    phase: 'inventory',
    team,
    toolVersion: TOOL_VERSION,
    url,
    window: { since: new Date(since).toISOString(), until: new Date(until).toISOString() }
  };
  fs.writeFileSync(path.join(out, 'index.json'), `${JSON.stringify(index, undefined, 2)}\n`);
  process.stdout.write(`\n${rows.length} turns → ${path.join(out, 'manifest.jsonl')}\n`);
  process.stdout.write('Set "include": true on the rows you want, then run export (or export --all).\n');
}

/* -------------------------------------------------------------------------- */
/* export                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} file
 * @returns {ManifestRow[]}
 */
function readManifest(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/**
 * @param {string} file
 * @param {readonly unknown[]} rows
 * @returns {void}
 */
function writeJsonLines(file, rows) {
  fs.writeFileSync(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(''));
}

/**
 * @param {CliValues} options
 * @returns {Promise<void>}
 */
async function runExport(options) {
  if (options.manifest === undefined) {
    fail('--manifest is required');
  }
  const manifestPath = path.resolve(options.manifest);
  const outDir = options.out ?? path.dirname(manifestPath);
  const indexPath = path.join(path.dirname(manifestPath), 'index.json');
  if (!fs.existsSync(indexPath)) {
    fail(`no index.json beside ${manifestPath}; run inventory first`);
  }
  /** @type {RunIndex} */
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const url = options.url ?? process.env.COLLEGIUM_MATTERMOST_URL ?? index.url;
  const team = options.team ?? process.env.COLLEGIUM_MATTERMOST_TEAM ?? index.team;

  const selected = readManifest(manifestPath).filter((row) => options.all === true || row.include);
  if (selected.length === 0) {
    fail('nothing selected: set "include": true on some rows, or pass --all');
  }

  const session = await authenticate(url.replace(/\/$/, ''));
  const channels = await resolveChannels(session, team, [...new Set(selected.map((row) => row.channel))]);
  const channelIds = new Map(channels.map((channel) => [channel.handle, channel.id]));
  const delay = Number(options.delay ?? 0);

  /** @type {ExportedRow[]} */
  const written = [];
  for (const [position, row] of selected.entries()) {
    const channelId = channelIds.get(row.channel);
    if (channelId === undefined) {
      fail(`manifest row names channel "${row.channel}", which did not resolve`);
    }
    const trace = await runSlashCommand(session, channelId, `/collegium trace ${row.statusPostId}`);
    const header = TRACE_HEADER_PATTERN.exec(trace)?.groups;
    const traceDir = path.join(outDir, 'traces', row.channel);
    fs.mkdirSync(traceDir, { recursive: true });
    const name = header?.turnId ?? row.statusPostId;
    const tracePath = path.join(traceDir, `${name}.txt`);
    fs.writeFileSync(tracePath, trace);
    written.push({
      ...row,
      chain: header === undefined ? undefined : Number(header.chain),
      depth: header === undefined ? undefined : Number(header.depth),
      model: header?.model,
      outcome: header?.outcome,
      traceChars: trace.length,
      tracePath: path.relative(outDir, tracePath),
      turnId: header?.turnId
    });
    const note = header === undefined ? ' (no trace header — the turn may have recorded no events)' : '';
    process.stdout.write(
      `[${position + 1}/${selected.length}] ${row.channel} ${name}: ${trace.length.toLocaleString()} chars${note}\n`
    );
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  writeJsonLines(path.join(outDir, 'exported.jsonl'), written);
  /** @type {RunIndex} */
  const updated = {
    ...index,
    exportedAt: new Date().toISOString(),
    exportedTurns: written.length,
    phase: 'export'
  };
  fs.writeFileSync(indexPath, `${JSON.stringify(updated, undefined, 2)}\n`);
  process.stdout.write(`\n${written.length} traces → ${path.join(outDir, 'traces')}\n`);
}

/* -------------------------------------------------------------------------- */

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    agent: { multiple: true, type: 'string' },
    all: { type: 'boolean' },
    channel: { multiple: true, type: 'string' },
    delay: { type: 'string' },
    help: { short: 'h', type: 'boolean' },
    manifest: { type: 'string' },
    out: { type: 'string' },
    since: { type: 'string' },
    team: { type: 'string' },
    until: { type: 'string' },
    url: { type: 'string' }
  },
  strict: true
});

if (values.help === true || positionals.length === 0) {
  process.stdout.write(`${usage()}\n`);
  process.exit(values.help === true ? 0 : 1);
}

switch (positionals[0]) {
  case 'export':
    await runExport(values);
    break;
  case 'inventory':
    await runInventory(values);
    break;
  default:
    fail(`unknown command "${positionals[0]}"\n\n${usage()}`);
}
