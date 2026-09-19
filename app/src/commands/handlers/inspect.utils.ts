import { parseQualifiedSkillName } from '@collegium/core/skills';

import type { AgentProfile } from '@/agents/agents.types.ts';
import type { SkillListing } from '@/skills/skills.service.ts';
import type { GrantedTool } from '@/tools/tools.registry.ts';
import { fenceCodeBlock } from '@/utils/markdown.utils.ts';

/** Mattermost rejects a post over 16383 characters; the summary, the fence and the notice ride inside this */
const MAX_RESPONSE_CHARS = 16_000;

/** held back so the truncation notice can never itself push the response over the cap */
const TRUNCATION_NOTICE_RESERVE = 64;

/** framework skills carry no namespace, so they group under this label */
const FRAMEWORK_SKILL_GROUP = 'framework';

/** §3.7 — the marker is on the tool, not the namespace: a namespace almost always holds both kinds */
const GATE_MARKER = '🔐';

const GATE_LEGEND = `${GATE_MARKER} requires human approval on every call (§3.7)`;

function groupBy<TItem>(items: readonly TItem[], keyOf: (item: TItem) => string): Map<string, TItem[]> {
  const groups = new Map<string, TItem[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function renderTools(tools: readonly GrantedTool[]): string {
  const byNamespace = groupBy(tools, ({ id: [namespace] }) => namespace);
  return Array.from(byNamespace, ([namespace, granted]) => {
    const names = granted.map(({ gates, id: [, name] }) => (gates ? `${name} ${GATE_MARKER}` : name));
    return `- ${namespace}: ${names.join(', ')}`;
  }).join('\n');
}

function renderSkills(skills: readonly SkillListing[]): string {
  const parsed = skills.map((skill) => ({ ...parseQualifiedSkillName(skill.name), description: skill.description }));
  const byNamespace = groupBy(parsed, (skill) => skill.namespace ?? FRAMEWORK_SKILL_GROUP);
  return Array.from(byNamespace, ([namespace, entries]) => [
    `- ${namespace}:`,
    ...entries.map((skill) => `  - ${skill.skillName} — ${skill.description}`)
  ])
    .flat()
    .join('\n');
}

function renderSchedules(schedules: readonly InspectedSchedule[]): readonly string[] {
  if (schedules.length === 0) {
    return [];
  }
  return [
    '',
    'Schedules:',
    ...schedules.map(({ channel, handle, nextOccurrence }) => `- ${handle} (~${channel}): next ${nextOccurrence}`)
  ];
}

function renderSummary(report: InspectReport): string {
  const { profile } = report;
  return [
    `Agent @${profile.username}`,
    `- Model: ${profile.model.name} (${profile.model.provider})`,
    `- Context budget: ${profile.contextBudgetTokens} tokens`,
    `- Action budget: ${profile.actionBudget} attempts per turn`,
    `- Expertise: ${profile.expertise}`,
    '',
    'Tools:',
    renderTools(report.tools),
    ...(report.tools.some(({ gates }) => gates) ? ['', GATE_LEGEND] : []),
    '',
    'Skills:',
    renderSkills(report.skills),
    ...renderSchedules(report.schedules),
    '',
    'System prompt in this channel:'
  ].join('\n');
}

/** one schedule as the listing shows it: when it next fires is already in the operator timezone (§8.4) */
export type InspectedSchedule = {
  readonly channel: string;
  readonly handle: string;
  readonly nextOccurrence: string;
};

export type InspectReport = {
  readonly profile: AgentProfile;
  readonly prompt: string;
  readonly schedules: readonly InspectedSchedule[];
  readonly skills: readonly SkillListing[];
  readonly tools: readonly GrantedTool[];
};

/** the summary sections are always whole; only the prompt, the one open-ended section, is cut to fit the post cap */
export function renderInspectResponse(report: InspectReport): string {
  const summary = renderSummary(report);
  const respond = (prompt: string) => `${summary}\n${fenceCodeBlock(prompt, 'text')}`;
  const whole = respond(report.prompt);
  // overhead measured around the whole prompt, not '': a slice's fence is never longer, but an empty body's may be shorter
  const budget = MAX_RESPONSE_CHARS - (whole.length - report.prompt.length) - TRUNCATION_NOTICE_RESERVE;
  if (report.prompt.length <= budget) {
    return whole;
  }
  return `${respond(report.prompt.slice(0, budget))}\n… [truncated, ${report.prompt.length - budget} characters omitted]`;
}
