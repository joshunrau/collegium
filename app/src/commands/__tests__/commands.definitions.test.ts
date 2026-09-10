import { describe, expect, it } from 'vitest';

import { describeCommandSurface, renderCommandName, renderSurfaceUsage, renderUsage } from '../commands.definitions.ts';

describe('renderCommandName', () => {
  it('should render the subcommand under /collegium', () => {
    expect(renderCommandName('stop')).toBe('/collegium stop');
  });
});

describe('renderUsage', () => {
  it('should render the command name followed by its argument hint', () => {
    expect(renderUsage('memory')).toBe('Usage: /collegium memory {agent} [show {reference} | prune {reference}]');
  });

  it('should render an argument-less command without a trailing space', () => {
    expect(renderUsage('resume')).toBe('Usage: /collegium resume');
  });
});

describe('describeCommandSurface', () => {
  it('should declare every subcommand with its hint and purpose, in order', () => {
    expect(describeCommandSurface()[0]).toStrictEqual({
      hint: '{post-id}',
      purpose: 'Remove a post from agent context',
      trigger: 'forget'
    });
  });
});

describe('renderSurfaceUsage', () => {
  it('should list every subcommand under the bare usage line', () => {
    expect(renderSurfaceUsage()).toContain('Usage: /collegium {subcommand}\n- /collegium forget {post-id} — Remove');
    expect(renderSurfaceUsage()).toContain('- /collegium resume — Clear a global halt');
  });
});
