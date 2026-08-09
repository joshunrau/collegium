/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import type { FormElement, SnapshotCapture } from './snapshot.types.ts';

/**
 * Runs inside the page: `page.evaluate` serializes the function source, so everything it needs
 * lives in its own body — no imports, no module-scope references, a JSON-serializable return.
 * The DOM lib references above exist for this file alone; the server program has no DOM.
 *
 * Stamps every interactable in the live document with a `data-collegium-ref` attribute — reusing
 * existing stamps so a ref handed to the model can never come to mean a different element — then
 * serializes a clone with a visible `⟨eN⟩` marker beside each stamped element, leaving the live
 * document unmarked for the next action to target.
 */
export function captureSnapshot(nextRefIndex: number): SnapshotCapture {
  const REF_ATTRIBUTE = 'data-collegium-ref';
  let refIndex = nextRefIndex;

  const isExcluded = (element: Element): boolean => {
    return (
      element.hasAttribute('disabled') || element.hasAttribute('hidden') || element.getAttribute('type') === 'hidden'
    );
  };

  const refByElement = new Map<Element, string>();
  const interactables = document.querySelectorAll(
    'a[href], button, input, select, textarea, [role=button], [role=link]'
  );
  for (const element of interactables) {
    if (isExcluded(element)) {
      continue;
    }
    const existing = element.getAttribute(REF_ATTRIBUTE);
    if (existing) {
      refByElement.set(element, existing);
    } else {
      const ref = `e${refIndex}`;
      refIndex += 1;
      element.setAttribute(REF_ATTRIBUTE, ref);
      refByElement.set(element, ref);
    }
  }

  const firstNonEmpty = (...candidates: (null | string | undefined)[]): string => {
    for (const candidate of candidates) {
      if (candidate) {
        return candidate;
      }
    }
    return '';
  };

  const controlLabel = (element: Element): string => {
    if (element.tagName === 'BUTTON') {
      return firstNonEmpty(element.textContent?.trim(), element.getAttribute('aria-label'));
    }
    const id = element.getAttribute('id');
    const forLabel = id ? document.querySelector(`label[for="${id}"]`)?.textContent?.trim() : undefined;
    return firstNonEmpty(
      forLabel,
      element.getAttribute('aria-label'),
      element.getAttribute('placeholder'),
      element.getAttribute('name')
    );
  };

  const describeControl = (element: Element, ref: string): FormElement | null => {
    if (element instanceof HTMLInputElement) {
      return { kind: 'input', label: controlLabel(element), ref, type: element.type, value: element.value };
    }
    if (element instanceof HTMLButtonElement) {
      return { kind: 'button', label: controlLabel(element), ref, value: element.value };
    }
    if (element instanceof HTMLSelectElement) {
      return { kind: 'select', label: controlLabel(element), ref, value: element.value };
    }
    if (element instanceof HTMLTextAreaElement) {
      return { kind: 'textarea', label: controlLabel(element), ref, value: element.value };
    }
    return null;
  };

  const formElements: FormElement[] = [];
  for (const [element, ref] of refByElement) {
    const control = describeControl(element, ref);
    if (control) {
      formElements.push(control);
    }
  }

  const clone = document.documentElement.cloneNode(true);
  if (!(clone instanceof HTMLElement)) {
    throw new Error('cloning the document element did not produce an element');
  }
  for (const stamped of clone.querySelectorAll(`[${REF_ATTRIBUTE}]`)) {
    const marker = document.createTextNode(`⟨${stamped.getAttribute(REF_ATTRIBUTE)}⟩`);
    stamped.parentNode?.insertBefore(marker, stamped.nextSibling);
  }

  return { formElements, html: clone.outerHTML, nextRefIndex: refIndex };
}
