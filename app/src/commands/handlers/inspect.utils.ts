import { parseQualifiedSkillName } from '@collegium/core/skills';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { renderTimeSpan } from '@/formatting/durations/duration.utils.ts';
import type { SkillListing } from '@/skills/skills.service.ts';
import type { GrantedTool } from '@/tools/tools.registry.ts';
import { viewCapCharsFor } from '@/turns/retention/retention.utils.ts';
import { preventWrappingAtHyphens, quoteBlock, renderCodeSpan, renderTable } from '@/utils/markdown.utils.ts';

/** Mattermost rejects a post over 16383 characters; the summary, the quoted prompt and the notice ride inside this */
const MAX_RESPONSE_CHARS = 16_000;

/** held back so the truncation notice and the blank lines around it can never push the response over the cap */
const TRUNCATION_NOTICE_RESERVE = 96;

/** framework skills carry no namespace, so they group under this label */
const FRAMEWORK_SKILL_GROUP = 'framework';

/** §3.7 — the marker is on the tool, not the namespace: a namespace almost always holds both kinds */
const GATE_MARKER = '\\*';

const GATE_LEGEND = '_\\* Requires human approval on every call (§3.7)._';

const COUNT_FORMAT = new Intl.NumberFormat('en-US');

function groupBy<TItem>(items: readonly TItem[], keyOf: (item: TItem) => string): Map<string, TItem[]> {
  const groups = new Map<string, TItem[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function renderName(name: string): string {
  return renderCodeSpan(preventWrappingAtHyphens(name));
}

function renderLabel(name: string): string {
  return `**${renderName(name)}**`;
}

function renderModel({ name, provider, reasoningEffort }: AgentProfile['model']): string {
  const effort = reasoningEffort === undefined ? '' : `, reasoning: ${reasoningEffort}`;
  return `${renderCodeSpan(name)} (${provider}${effort})`;
}

function renderProfile(profile: AgentProfile): string {
  return renderTable(
    ['Setting', 'Value'],
    [
      ['**Expertise**', profile.expertise],
      ['**Model**', renderModel(profile.model)],
      ['**Context Budget**', `${COUNT_FORMAT.format(profile.contextBudgetTokens)} tokens`],
      [
        '**Turn Ceiling**',
        `${COUNT_FORMAT.format(profile.turnContextCeilingTokens)} tokens; a result over ${COUNT_FORMAT.format(viewCapCharsFor(profile))} characters, or over its tool's narrower view, is shown in part`
      ],
      ['**Completion Time Limit**', renderTimeSpan(profile.completionTimeLimitMs)],
      ['**Action Budget**', `${COUNT_FORMAT.format(profile.actionBudget)} attempts per turn`]
    ]
  );
}

function renderTools(tools: readonly GrantedTool[]): string {
  const byNamespace = groupBy(tools, ({ id: [namespace] }) => namespace);
  const table = renderTable(
    ['Toolset', 'Tools'],
    Array.from(byNamespace, ([namespace, granted]) => [
      renderLabel(namespace),
      granted.map(({ gates, id: [, name] }) => `${renderName(name)}${gates ? GATE_MARKER : ''}`).join(', ')
    ])
  );
  return tools.some(({ gates }) => gates) ? `${table}\n\n${GATE_LEGEND}` : table;
}

function renderSkills(skills: readonly SkillListing[]): string {
  return renderTable(
    ['Source', 'Skill', 'Description'],
    skills.map((skill) => {
      const { namespace, skillName } = parseQualifiedSkillName(skill.name);
      return [renderLabel(namespace ?? FRAMEWORK_SKILL_GROUP), renderName(skillName), skill.description];
    })
  );
}

function renderSchedules(schedules: readonly InspectedSchedule[]): string {
  return renderTable(
    ['Schedule', 'Channel', 'Next Occurrence'],
    schedules.map(({ channel, handle, nextOccurrence }) => [renderLabel(handle), `~${channel}`, nextOccurrence])
  );
}

function renderSection(heading: string, body: string): string {
  return `#### ${heading}\n\n${body}`;
}

/** a section with nothing to show is left out, so every heading present answers a question */
function renderSummary(report: InspectReport): string {
  return [
    `### @${report.profile.username}`,
    renderSection('Profile', renderProfile(report.profile)),
    ...(report.tools.length > 0 ? [renderSection('Tools', renderTools(report.tools))] : []),
    ...(report.skills.length > 0 ? [renderSection('Skills', renderSkills(report.skills))] : []),
    ...(report.schedules.length > 0 ? [renderSection('Schedules', renderSchedules(report.schedules))] : []),
    '#### Prompt in This Channel'
  ].join('\n\n');
}

/** whole lines only: a cut inside one could leave an unclosed span, which would format the rest of the quote */
function takeLinesWithin(lines: readonly string[], budget: number): readonly string[] {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    used += line.length + 1;
    if (used > budget) {
      break;
    }
    kept.push(line);
  }
  return kept;
}

function renderTruncationNotice(prompt: string, keptLineCount: number): string {
  const kept = prompt.split('\n').slice(0, keptLineCount).join('\n');
  const omitted = prompt.length - kept.length;
  return `_… truncated — ${COUNT_FORMAT.format(omitted)} of ${COUNT_FORMAT.format(prompt.length)} characters omitted._`;
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

/**
 * §8.4 — the summary sections are always whole; only the prompt, the one open-ended section, is cut
 * to fit the post cap. It is quoted rather than fenced, so it renders as the Markdown it is.
 */
export function renderInspectResponse(report: InspectReport): string {
  const summary = renderSummary(report);
  const quoted = quoteBlock(report.prompt).split('\n');
  const kept = takeLinesWithin(quoted, MAX_RESPONSE_CHARS - summary.length - TRUNCATION_NOTICE_RESERVE);
  if (kept.length === quoted.length) {
    return [summary, quoted.join('\n')].join('\n\n');
  }
  return [summary, kept.join('\n'), renderTruncationNotice(report.prompt, kept.length)]
    .filter((block) => block !== '')
    .join('\n\n');
}
