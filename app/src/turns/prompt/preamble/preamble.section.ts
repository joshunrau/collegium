import { renderAddressingPreamble } from './addressing.preamble.ts';
import { renderApprovalsPreamble } from './approvals.preamble.ts';
import { renderAskPreamble } from './ask.preamble.ts';
import { renderAttemptsPreamble } from './attempts.preamble.ts';
import { renderContextBudgetPreamble } from './context-budget.preamble.ts';
import { renderContextPreamble } from './context.preamble.ts';
import { renderEarlierActionsPreamble } from './earlier-actions.preamble.ts';
import { renderMailPreamble } from './mail.preamble.ts';
import { renderMarkdownPreamble } from './markdown.preamble.ts';
import { renderMemoryPreamble } from './memory.preamble.ts';
import { renderOperatorPreamble } from './operator.preamble.ts';
import { renderRepliesPreamble } from './replies.preamble.ts';
import { renderSearchPreamble } from './search.preamble.ts';
import { renderShellPreamble } from './shell.preamble.ts';
import { renderSkillsPreamble } from './skills.preamble.ts';
import { renderTriggersPreamble } from './triggers.preamble.ts';
import { renderTurnStartsPreamble } from './turn-starts.preamble.ts';
import { renderWorkUnitsPreamble } from './work-units.preamble.ts';
import { renderWorkspacePreamble } from './workspace.preamble.ts';

import type { StableParagraph, StablePromptInput } from '../prompt.types.ts';

const PREAMBLE_PARAGRAPHS: readonly StableParagraph[] = [
  renderContextPreamble,
  renderContextBudgetPreamble,
  renderEarlierActionsPreamble,
  renderRepliesPreamble,
  renderTurnStartsPreamble,
  renderMarkdownPreamble,
  renderApprovalsPreamble,
  renderAttemptsPreamble,
  renderMemoryPreamble,
  renderWorkspacePreamble,
  renderShellPreamble,
  renderMailPreamble,
  renderAskPreamble,
  renderSearchPreamble,
  renderSkillsPreamble,
  renderWorkUnitsPreamble,
  renderAddressingPreamble,
  renderTriggersPreamble,
  renderOperatorPreamble
];

/**
 * §3.8 — every sentence states what the framework does, never what the model ought to do; an
 * instruction does not belong here. Each is a runtime fact the model could otherwise learn only
 * by failing, which is what the enumeration in §3.8 bounds this section to.
 */
export function renderPreambleSection(input: StablePromptInput): string {
  const paragraphs = PREAMBLE_PARAGRAPHS.map((render) => render(input)).filter((paragraph) => paragraph !== undefined);
  return input.textFormatter.formatParagraphs(['## How this works', ...paragraphs], {});
}
