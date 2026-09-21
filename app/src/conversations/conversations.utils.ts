import { renderReplayLine } from '@collegium/core/tools';

import type { ModelRow } from '@/prisma/prisma.types.ts';

function renderAttachmentLine(file: PrismaJson.PostAttachments['files'][number]): string {
  const details = [file.mimeType, `${file.size} bytes`].filter((detail) => detail !== '');
  return `[attached: ${file.name} (${details.join(', ')})]`;
}

/**
 * A post as the model reads it: its text, then one line naming each file it carried (§3.8). The one
 * place the marker is spelled, so the window's cost estimate and the assembled prompt cannot
 * disagree. A file the substrate reported without metadata is counted rather than named.
 */
export function renderPostWithAttachments(post: Pick<ModelRow<'Post'>, 'attachments' | 'message'>): string {
  const files = post.attachments?.files ?? [];
  const named = files.filter((file) => file.name !== '');
  const unnamed = files.length - named.length;
  return [
    post.message,
    ...named.map(renderAttachmentLine),
    ...(unnamed === 0 ? [] : [`[${unnamed} file${unnamed === 1 ? '' : 's'} attached, name unavailable]`])
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * §3.8 — what a later turn reads in place of a result: the line rendered from the subject the tool
 * named, else the line the tool wrote itself (a plugin's, or a row from before subjects were
 * stored), else nothing, for a result short enough to be kept as it was.
 */
export function replayTextOf(payload: PrismaJson.TurnEventPayload): string | undefined {
  if (payload.kind !== 'tool_result') {
    return undefined;
  }
  return payload.replaySubject === undefined ? payload.replay : renderReplayLine(payload.replaySubject);
}
