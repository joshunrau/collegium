import { renderColleaguesBaseline } from './colleagues.baseline.ts';
import { renderDeliveryBaseline } from './delivery.baseline.ts';
import { renderDisagreementBaseline } from './disagreement.baseline.ts';
import { renderFailuresBaseline } from './failures.baseline.ts';
import { renderMemoryBaseline } from './memory.baseline.ts';
import { renderOutsideContentBaseline } from './outside-content.baseline.ts';
import { renderRepliesBaseline } from './replies.baseline.ts';
import { renderScopeBaseline } from './scope.baseline.ts';
import { renderVerificationBaseline } from './verification.baseline.ts';

import type { StableParagraph, StablePromptInput } from '../prompt.types.ts';

const BASELINE_PARAGRAPHS: readonly StableParagraph[] = [
  renderScopeBaseline,
  renderDeliveryBaseline,
  renderOutsideContentBaseline,
  renderVerificationBaseline,
  renderFailuresBaseline,
  renderColleaguesBaseline,
  renderRepliesBaseline,
  renderMemoryBaseline,
  renderDisagreementBaseline
];

/**
 * §3.8 — the advisory instructions every agent works under. Held to a budget rather than a list:
 * an instruction added here is paid for by one removed, since compliance with all of them at once
 * falls with their count, and the memory paragraph renders only for an agent that holds memory.
 */
export function renderBaselineSection(input: StablePromptInput): string {
  const paragraphs = BASELINE_PARAGRAPHS.map((render) => render(input)).filter((paragraph) => paragraph !== undefined);
  return input.textFormatter.formatParagraphs(['## How you work', ...paragraphs], {});
}
