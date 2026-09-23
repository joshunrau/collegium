import { deriveShellHomeDir } from '@/shell/shell.utils.ts';

import type { StablePromptInput } from '../prompt.types.ts';

/**
 * §3.8 — the shell's environment, which the agent cannot otherwise learn without failing: the shell
 * user reading the workspace and writing only its own home (§A2), a shell output too large for a
 * result spilling into the workspace, and which commands exist being what the boot probe found.
 */
export function renderShellPreamble({
  granted,
  presentCommands,
  profile,
  textFormatter
}: StablePromptInput): string | undefined {
  if (!granted.some(({ id: [namespace, tool] }) => namespace === 'shell' && tool === 'run')) {
    return undefined;
  }
  const holdsWorkspace = granted.some(({ id: [namespace] }) => namespace === 'workspace');
  const holdsWorkspaceRead = granted.some(({ id: [namespace, tool] }) => namespace === 'workspace' && tool === 'read');
  const shell = [
    'shell__run runs each command as your own OS user, starting in {shellHomeDir}.',
    ...(holdsWorkspace
      ? ['That user can read {workspaceDir} but not write it, and the workspace tools cannot reach {shellHomeDir}.']
      : []),
    ...(holdsWorkspaceRead
      ? [
          'Where a shell output is too large for a result, the framework, not your shell user, saves it into {workspaceDir} and names the file in the result.'
        ]
      : []),
    'The shell runs under bash with pipefail.',
    ...(presentCommands.length === 0
      ? []
      : ['Beside the usual POSIX utilities, these commands are present: {shellCommands}.']),
    'The shell reaches the network under no address policy.'
  ].join(' ');
  return textFormatter.formatParagraphs([shell], {
    shellCommands: textFormatter.formatConjunction(presentCommands),
    shellHomeDir: deriveShellHomeDir(profile.username),
    workspaceDir: profile.workspaceDir
  });
}
