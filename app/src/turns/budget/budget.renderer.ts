/**
 * §5.3 — what a reasoned denial of an extension tells the model. It is framework text carrying a
 * human's own words, so it says both halves plainly: the reason, and that nothing further may be
 * done about it. A model told only "denied" tries an adjacent path; one told the budget is closed
 * answers in words, which is exactly what "stop and tell me what you have" asked for.
 */
export function renderExtensionDenialResult(reason: string): string {
  return [
    `The request to continue was denied: ${reason}`,
    '',
    'No action attempts remain and no further extension will be offered. Reply with what you have.'
  ].join('\n');
}
