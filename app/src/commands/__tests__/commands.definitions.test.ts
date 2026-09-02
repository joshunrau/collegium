import { describe, expect, it } from 'vitest';

import { renderAutocompleteHint, renderCommandListing, renderUsage } from '../commands.definitions.ts';

describe('renderUsage', () => {
  it('should render the parent trigger, subcommand, and its argument hint', () => {
    expect(renderUsage('memory')).toBe('Usage: /collegium memory {agent} [prune {reference}]');
  });

  it('should render an argument-less subcommand without a trailing space', () => {
    expect(renderUsage('resume')).toBe('Usage: /collegium resume');
  });
});

describe('renderAutocompleteHint', () => {
  it('should list every subcommand with its arguments', () => {
    expect(renderAutocompleteHint()).toContain('forget {post-id} | kill | memory {agent} [prune {reference}]');
  });
});

describe('renderCommandListing', () => {
  it('should render one line per subcommand with its purpose', () => {
    expect(renderCommandListing().split('\n')).toEqual(
      expect.arrayContaining([
        'Usage: /collegium {subcommand}',
        '- stop — Abort current turns in this channel at the next boundary'
      ])
    );
  });
});
