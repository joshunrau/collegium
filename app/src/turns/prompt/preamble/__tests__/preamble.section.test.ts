import { describe, expect, it } from 'vitest';

import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderPreambleSection } from '../preamble.section.ts';

describe('renderPreambleSection', () => {
  it('should open the preamble with the agent’s own name and handle (§3.8)', () => {
    expect(
      renderPreambleSection(buildStablePromptInput({ profile: buildAgentProfile({ displayName: 'Mira Turner' }) }))
    ).toContain('## How this works\n\nYou are Mira Turner (@mira), one of a group of agents.');
  });

  it('should name both directories, the shell user’s read-only view of the workspace and the output spill for an agent holding both (§3.8)', () => {
    const preamble = renderPreambleSection(
      buildStablePromptInput({
        granted: [
          { gates: true, id: ['shell', 'run'] },
          { gates: false, id: ['workspace', 'read'] }
        ],
        presentCommands: ['node', 'git'],
        profile: buildAgentProfile({ workspaceDir: '/var/lib/collegium/workspaces/mira' })
      })
    );
    expect(preamble).toContain(
      'workspace__read and workspace__write share one directory, /var/lib/collegium/workspaces/mira.\n\nshell__run runs each command as your own OS user, starting in /home/collegium-mira. That user can read /var/lib/collegium/workspaces/mira but not write it, and the workspace tools cannot reach /home/collegium-mira. Where a shell output is too large for a result, the framework, not your shell user, saves it into /var/lib/collegium/workspaces/mira and names the file in the result. The shell runs under bash with pipefail.'
    );
  });
});
