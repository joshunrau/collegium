import { describe, expect, it } from 'vitest';

import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderWorkspacePreamble } from '../workspace.preamble.ts';

describe('renderWorkspacePreamble', () => {
  it('should name no directory for an agent holding no workspace tool (§3.8)', () => {
    expect(
      renderWorkspacePreamble(buildStablePromptInput({ granted: [{ gates: true, id: ['shell', 'run'] }] }))
    ).toBeUndefined();
  });

  it('should name the workspace directory for an agent holding a workspace tool (§3.8)', () => {
    const paragraph = renderWorkspacePreamble(
      buildStablePromptInput({
        granted: [{ gates: false, id: ['workspace', 'read'] }],
        profile: buildAgentProfile({ workspaceDir: '/var/lib/collegium/workspaces/mira' })
      })
    );
    expect(paragraph).toBe(
      'workspace__read and workspace__write share one directory, /var/lib/collegium/workspaces/mira.'
    );
  });
});
