import { parseQualifiedSkillName } from '@collegium/core/skills';
import type { ToolId } from '@collegium/core/tools';

import type { AgentProfile } from '@/agents/agents.types.ts';
import type { SkillListing } from '@/skills/skills.service.ts';

/** Mattermost rejects a post over 16383 characters; the summary, the fence and the notice ride inside this */
const MAX_RESPONSE_CHARS = 16_000;

/** held back so the truncation notice can never itself push the response over the cap */
const TRUNCATION_NOTICE_RESERVE = 64;

/** framework skills carry no namespace, so they group under this label */
const FRAMEWORK_SKILL_GROUP = 'framework';

function groupBy<TItem>(items: readonly TItem[], keyOf: (item: TItem) => string): Map<string, TItem[]> {
  const groups = new Map<string, TItem[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function renderTools(tools: readonly ToolId[]): string {
  const byNamespace = groupBy(tools, ([namespace]) => namespace);
  return Array.from(
    byNamespace,
    ([namespace, ids]) => `- ${namespace}: ${ids.map(([, name]) => name).join(', ')}`
  ).join('\n');
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

function renderSummary(report: InspectReport): string {
  const { profile } = report;
  return [
    `Agent @${profile.username}`,
    `- Model: ${profile.model.name} (${profile.model.provider})`,
    `- Context budget: ${profile.contextBudgetTokens} tokens`,
    `- Expertise: ${profile.expertise}`,
    '',
    'Tools:',
    renderTools(report.tools),
    '',
    'Skills:',
    renderSkills(report.skills),
    '',
    'System prompt in this channel:'
  ].join('\n');
}

export type InspectReport = {
  readonly profile: AgentProfile;
  readonly prompt: string;
  readonly skills: readonly SkillListing[];
  readonly tools: readonly ToolId[];
};

/** the summary sections are always whole; only the prompt, the one open-ended section, is cut to fit the post cap */
export function renderInspectResponse(report: InspectReport): string {
  const summary = renderSummary(report);
  const fence = (body: string) => `${summary}\n\`\`\`text\n${body}\n\`\`\``;
  const budget = MAX_RESPONSE_CHARS - fence('').length - TRUNCATION_NOTICE_RESERVE;
  if (report.prompt.length <= budget) {
    return fence(report.prompt);
  }
  return `${fence(report.prompt.slice(0, budget))}\n… [truncated, ${report.prompt.length - budget} characters omitted]`;
}
