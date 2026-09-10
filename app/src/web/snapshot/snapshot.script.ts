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
 * document unmarked for the next action to target. A hidden element's mark reads `⟨eN⟩ (hidden)`:
 * the delimiters hold the ref alone, since that is the token the model copies into an action.
 */
export function captureSnapshot(nextRefIndex: number): SnapshotCapture {
  const REF_ATTRIBUTE = 'data-collegium-ref';
  let refIndex = nextRefIndex;

  const isExcluded = (element: Element): boolean => {
    return (
      element.hasAttribute('disabled') || element.hasAttribute('hidden') || element.getAttribute('type') === 'hidden'
    );
  };

  /**
   * Playwright's visibility test — no box, or CSS has turned it invisible — which is the check an
   * action fails first; an element under an overlay passes it and still cannot be clicked. Stamping
   * a hidden one is right — a hover on its parent may reveal it — but the model has to be told, or
   * it spends a click on a guaranteed timeout.
   */
  const isHidden = (element: Element): boolean => {
    return element.getClientRects().length === 0 || getComputedStyle(element).visibility === 'hidden';
  };

  const candidates: Element[] = [];
  for (const element of document.querySelectorAll(
    'a[href], button, input, select, textarea, [role=button], [role=link]'
  )) {
    if (!isExcluded(element)) {
      candidates.push(element);
    }
  }
  // every read before the first write: stamping between two `getClientRects` calls would force one
  // reflow per element, and a faculty directory carries hundreds
  const hiddenFlags = candidates.map((element) => isHidden(element));

  const refByElement = new Map<Element, string>();
  const hiddenRefs = new Set<string>();
  for (const [index, element] of candidates.entries()) {
    const existing = element.getAttribute(REF_ATTRIBUTE);
    const ref = existing ?? `e${refIndex}`;
    if (!existing) {
      refIndex += 1;
      element.setAttribute(REF_ATTRIBUTE, ref);
    }
    refByElement.set(element, ref);
    if (hiddenFlags[index]) {
      hiddenRefs.add(ref);
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
    const isHiddenRef = hiddenRefs.has(ref);
    if (element instanceof HTMLInputElement) {
      return {
        isFilled: element.value !== '',
        isHidden: isHiddenRef,
        kind: 'input',
        label: controlLabel(element),
        ref,
        type: element.type
      };
    }
    if (element instanceof HTMLButtonElement) {
      return { isHidden: isHiddenRef, kind: 'button', label: controlLabel(element), ref, value: element.value };
    }
    if (element instanceof HTMLSelectElement) {
      return { isHidden: isHiddenRef, kind: 'select', label: controlLabel(element), ref, value: element.value };
    }
    if (element instanceof HTMLTextAreaElement) {
      return {
        isFilled: element.value !== '',
        isHidden: isHiddenRef,
        kind: 'textarea',
        label: controlLabel(element),
        ref
      };
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
    const ref = stamped.getAttribute(REF_ATTRIBUTE) ?? '';
    const marker = document.createTextNode(hiddenRefs.has(ref) ? `⟨${ref}⟩ (hidden)` : `⟨${ref}⟩`);
    stamped.parentNode?.insertBefore(marker, stamped.nextSibling);
  }

  return { formElements, html: clone.outerHTML, nextRefIndex: refIndex };
}
