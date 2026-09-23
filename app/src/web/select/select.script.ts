/// <reference lib="dom" />

/**
 * Runs inside the page: `locator.evaluate` serializes the function source, so it carries nothing
 * from outside its own body.
 *
 * Whether a select offers nothing matching `option` by the value or the label Playwright matches it
 * against. Asked first because Playwright waits out its whole timeout for an option that is not
 * there, and a timeout says nothing of why. An element that is not a select lacks nothing here:
 * the action itself says what it is not.
 */
export function lacksOption(element: Element, option: string): boolean {
  if (!(element instanceof HTMLSelectElement)) {
    return false;
  }
  return ![...element.options].some((candidate) => candidate.value === option || candidate.label === option);
}
