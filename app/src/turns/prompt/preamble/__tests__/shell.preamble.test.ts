import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';
import type { GrantedTool } from '@/tools/tools.registry.ts';

import { renderShellPreamble } from '../shell.preamble.ts';

const SHELL_RUN: GrantedTool = { gates: true, id: ['shell', 'run'] };

describe('renderShellPreamble', () => {
  it('should say nothing of the shell for an agent not holding shell run (§3.8)', () => {
    expect(renderShellPreamble(buildStablePromptInput({ presentCommands: ['node', 'git'] }))).toBeUndefined();
    expect(
      renderShellPreamble(buildStablePromptInput({ granted: [{ gates: false, id: ['workspace', 'read'] }] }))
    ).toBeUndefined();
  });

  it('should name the shell home alone for an agent holding shell run without a workspace tool (§3.8)', () => {
    const paragraph = renderShellPreamble(
      buildStablePromptInput({ granted: [SHELL_RUN], presentCommands: ['node', 'git'] })
    );
    expect(paragraph).toBe(
      'shell__run runs each command as your own OS user, starting in /home/collegium-mira. The shell runs under bash with pipefail. Beside the usual POSIX utilities, these commands are present: node and git. The shell reaches the network under no address policy.'
    );
    expect(paragraph).not.toContain('but not write it');
  });

  it('should say nothing about commands when the probe found none (§3.8)', () => {
    const paragraph = renderShellPreamble(buildStablePromptInput({ granted: [SHELL_RUN] }));
    expect(paragraph).toContain(
      'The shell runs under bash with pipefail. The shell reaches the network under no address policy.'
    );
    expect(paragraph).not.toContain('These commands are present');
  });
});
