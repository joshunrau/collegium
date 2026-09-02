import { describe, expect, it } from 'vitest';

import { renderCommandName, renderUsage } from '../commands.definitions.ts';

describe('renderCommandName', () => {
  it('should namespace the trigger under collegium', () => {
    expect(renderCommandName('stop')).toBe('/collegium.stop');
  });
});

describe('renderUsage', () => {
  it('should render the command name followed by its argument hint', () => {
    expect(renderUsage('memory')).toBe('Usage: /collegium.memory {agent} [prune {reference}]');
  });

  it('should render an argument-less command without a trailing space', () => {
    expect(renderUsage('resume')).toBe('Usage: /collegium.resume');
  });
});
