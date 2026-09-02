import { describe, expect, it } from 'vitest';

import { renderUsage } from '../commands.definitions.ts';

describe('renderUsage', () => {
  it('should render the trigger followed by its argument hint', () => {
    expect(renderUsage('memory')).toBe('Usage: /memory {agent} [prune {reference}]');
  });

  it('should render an argument-less trigger without a trailing space', () => {
    expect(renderUsage('resume')).toBe('Usage: /resume');
  });
});
