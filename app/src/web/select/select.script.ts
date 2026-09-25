/// <reference lib="dom" />

/**
 * Runs inside the page: `locator.evaluate` serializes the function source, so it carries nothing
 * from outside its own body.
 *
 * Null where the select offers `option` by the value or the label Playwright matches it against;
 * otherwise the labels that contain it, without regard to case, so a refusal can name what was
 * meant. Asked first because Playwright waits out its whole timeout for an option that is not
 * there, and a timeout says nothing of why. An element that is not a select lacks nothing here:
 * the action itself says what it is not.
 */
export function lacksOption(element: Element, option: string): null | string[] {
  if (!(element instanceof HTMLSelectElement)) {
    return null;
  }
  const options = [...element.options];
  if (options.some((candidate) => candidate.value === option || candidate.label === option)) {
    return null;
  }
  const wanted = option.toLowerCase();
  return options.map((candidate) => candidate.label).filter((label) => label.toLowerCase().includes(wanted));
}
