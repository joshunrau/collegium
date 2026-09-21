import { describe, expect, it } from 'vitest';

import { renderExtensionDenialResult } from '../budget.renderer.ts';

describe('renderExtensionDenialResult', () => {
  it('should name the person who closed the budget alongside the reason, and say what remains (§5.3)', () => {
    expect(renderExtensionDenialResult('casey', 'stop and summarise')).toBe(
      'casey denied the request to continue: stop and summarise\n\nNo action attempts remain and no further extension will be offered. Reply with what you have.'
    );
  });
});
