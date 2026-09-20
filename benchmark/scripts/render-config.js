/// <reference types="node" />

// @ts-check

/**
 * Writes the benchmark stack's config.json and plan.json from the one source of each fact: the
 * roster (who exists and what each holds), the task files (which channels a run needs and who sits
 * in them), and the shell environment (provider keys and the bench mailbox, which are never
 * committed). Re-run whenever the roster, a task, or the tier selection changes.
 *
 *   BENCH_TIERS=reference DEEPSEEK_API_KEY=… node benchmark/scripts/render-config.js
 *
 * Environment: DEEPSEEK_API_KEY (reference tier); OPENROUTER_API_KEY (control tier);
 * BRAVE_API_KEY (optional, enables web::search); BENCH_MAIL_ADDRESS, BENCH_MAIL_USERNAME,
 * BENCH_MAIL_PASSWORD, BENCH_MAIL_IMAP_HOST, BENCH_MAIL_SMTP_HOST (optional, renders the courier;
 * BENCH_MAIL_IMAP_PORT and BENCH_MAIL_SMTP_PORT default to 993 and 465). A second mailbox under
 * the prefix BENCH_MAIL_CTL_ renders the control tier's courier; without it that twin is left out,
 * since two pollers on one mailbox race each other.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const benchmarkRoot = path.resolve(here, '..');
const rosterPath = path.join(benchmarkRoot, 'roster.json');
const tasksDir = path.join(benchmarkRoot, 'tasks');
const stackDir = path.join(benchmarkRoot, 'stack');

const MAIL_POLL_INTERVAL_MS = 15_000;

/** @param {string} message */
function fail(message) {
  console.error(`render-config: ${message}`);
  process.exit(1);
}

/** @param {string} filepath */
function readJson(filepath) {
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

/** @param {string} name */
function capitalize(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * @param {string} prefix
 * @returns {undefined | { address: string; imap: { host: string; password: string; port: number; secure: true; username: string }; kind: 'imap'; smtp: { host: string; password: string; port: number; secure: true; username: string } }}
 */
function readMailbox(prefix) {
  const get = (/** @type {string} */ key) => process.env[`${prefix}${key}`];
  const required = ['ADDRESS', 'USERNAME', 'PASSWORD', 'IMAP_HOST', 'SMTP_HOST'];
  const present = required.filter((key) => get(key));
  if (present.length === 0) {
    return undefined;
  }
  if (present.length !== required.length) {
    fail(`mailbox under ${prefix} is partial; set all of ${required.map((key) => prefix + key).join(', ')} or none`);
  }
  const address = /** @type {string} */ (get('ADDRESS'));
  const credentials = {
    password: /** @type {string} */ (get('PASSWORD')),
    username: /** @type {string} */ (get('USERNAME'))
  };
  return {
    address,
    imap: {
      host: /** @type {string} */ (get('IMAP_HOST')),
      port: Number(get('IMAP_PORT') ?? 993),
      secure: true,
      ...credentials
    },
    kind: 'imap',
    smtp: {
      host: /** @type {string} */ (get('SMTP_HOST')),
      port: Number(get('SMTP_PORT') ?? 465),
      secure: true,
      ...credentials
    }
  };
}

const roster = readJson(rosterPath);
const order = readJson(path.join(tasksDir, 'order.json'));
const tasks = order.map((/** @type {string} */ id) => readJson(path.join(tasksDir, `${id}.json`)));
const tierNames = (process.env.BENCH_TIERS ?? 'reference').split(',').map((tier) => tier.trim());

for (const tier of tierNames) {
  if (!roster.tiers[tier]) {
    fail(`unknown tier "${tier}"; roster.json declares ${Object.keys(roster.tiers).join(', ')}`);
  }
}
for (const task of tasks) {
  for (const member of task.members ?? [task.agent]) {
    if (!roster.agents[member]) {
      fail(`task ${task.id} names agent "${member}", which roster.json does not declare`);
    }
  }
}

const providers = {};
if (tierNames.includes('reference')) {
  if (!process.env.DEEPSEEK_API_KEY) {
    fail('DEEPSEEK_API_KEY is required for the reference tier');
  }
  providers.deepseek = { apiKey: process.env.DEEPSEEK_API_KEY };
}
if (tierNames.includes('control')) {
  if (!process.env.OPENROUTER_API_KEY) {
    fail('OPENROUTER_API_KEY is required for the control tier');
  }
  providers.openrouter = { apiKey: process.env.OPENROUTER_API_KEY };
}

const mailboxes = { control: readMailbox('BENCH_MAIL_CTL_'), reference: readMailbox('BENCH_MAIL_') };

/** @type {{ [handle: string]: { triggeringMode: 'mention-required' } }} */
const channels = {};
/** @type {{ [username: string]: object }} */
const agents = {};
/** @type {{ tier: string; agents: string[]; tasks: object[] }[]} */
const plan = [];

for (const tier of tierNames) {
  const { suffix } = roster.tiers[tier];
  const mailbox = mailboxes[tier];
  const tierAgents = [];
  for (const [name, declared] of Object.entries(roster.agents)) {
    if (declared.mailbox && !mailbox) {
      continue;
    }
    const username = `${name}${suffix}`;
    tierAgents.push(username);
    agents[username] = {
      expertise: declared.expertise,
      model: roster.tiers[tier].model,
      systemPrompt: `You are ${capitalize(name)}.`,
      tools: declared.tools,
      ...(declared.skills ? { skills: declared.skills } : {}),
      ...(declared.actionBudget ? { actionBudget: declared.actionBudget } : {}),
      ...(declared.mailbox
        ? {
            toolSettings: {
              mail: { announcementChannel: `t-m1${suffix}`, pollIntervalMs: MAIL_POLL_INTERVAL_MS, provider: mailbox }
            }
          }
        : {})
    };
  }
  const tierTasks = [];
  for (const task of tasks) {
    const members = (task.members ?? [task.agent]).map((/** @type {string} */ member) => `${member}${suffix}`);
    if (members.some((member) => !agents[member])) {
      tierTasks.push({ id: task.id, skipped: `needs ${members.join(', ')}` });
      continue;
    }
    const handles = {};
    for (const channel of task.channels ?? ['main']) {
      const handle = channel === 'main' ? `t-${task.id}${suffix}` : `t-${task.id}-${channel}${suffix}`;
      channels[handle] = { triggeringMode: 'mention-required' };
      handles[channel] = handle;
    }
    tierTasks.push({ agent: `${task.agent}${suffix}`, channels: handles, id: task.id, members });
  }
  plan.push({ agents: tierAgents, tasks: tierTasks, tier });
}

const config = {
  $schema: 'https://collegium.sh/config.schema.json',
  agentDefaults: {
    contextBudgetTokens: 100_000,
    ...(process.env.BRAVE_API_KEY
      ? { toolSettings: { web: { search: { provider: { apiKey: process.env.BRAVE_API_KEY, kind: 'brave' } } } } }
      : {})
  },
  agents,
  mattermost: { channels },
  plugins: ['bookmark'],
  providers,
  turns: { hourlyCeiling: 500 },
  web: { allowPrivateAddresses: true }
};

fs.writeFileSync(path.join(stackDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
fs.writeFileSync(path.join(stackDir, 'plan.json'), `${JSON.stringify({ tiers: plan }, null, 2)}\n`);
process.stdout.write(
  `${`rendered ${Object.keys(agents).length} agents and ${Object.keys(channels).length} channels for ${tierNames.join(', ')} into benchmark/stack/config.json and plan.json`}\n`
);
