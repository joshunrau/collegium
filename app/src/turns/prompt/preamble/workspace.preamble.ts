import type { StablePromptInput } from '../prompt.types.ts';

export function renderWorkspacePreamble({ granted, profile, textFormatter }: StablePromptInput): string | undefined {
  if (!granted.some(({ id: [namespace] }) => namespace === 'workspace')) {
    return undefined;
  }
  return textFormatter.formatParagraphs(['workspace__read and workspace__write share one directory, {workspaceDir}.'], {
    workspaceDir: profile.workspaceDir
  });
}
