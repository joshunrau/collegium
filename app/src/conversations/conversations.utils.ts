import { renderReplayLine, replaySubjectWhenLong } from '@collegium/core/tools';

import type { ModelRow, PostKind } from '@/prisma/prisma.types.ts';
import { extractMentionedUsernames } from '@/utils/mention.utils.ts';
import { renderRecordedToolName } from '@/utils/tool-name.utils.ts';

import type { ObservedPost } from './conversations.types.ts';

function renderAttachmentLine(file: PrismaJson.PostAttachments['files'][number]): string {
  const details = [file.mimeType, `${file.size} bytes`].filter((detail) => detail !== '');
  return `[attached: ${file.name} (${details.join(', ')})]`;
}

/** §5.2 — the posts a turn speaks in, the only ones that address a colleague: never its status post, nor a prompt it parks on (§4.5) */
export const SPOKEN_POST_KINDS = ['notice', 'reply'] as const satisfies readonly PostKind[];

export type SpokenPostKind = (typeof SPOKEN_POST_KINDS)[number];

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
 * A stored post as the live stream observed it (§4.5): its mentions read off its text with the same
 * grammar, and its channel's kind, which the store does not keep, supplied by whoever knows it.
 */
export function restoreObservedPost(
  post: Pick<
    ModelRow<'Post'>,
    'attachments' | 'authorKind' | 'authorUsername' | 'channelId' | 'createdAt' | 'id' | 'message'
  >,
  isDirectMessage: boolean
): ObservedPost {
  return {
    attachments: post.attachments?.files ?? [],
    authorKind: post.authorKind,
    authorUsername: post.authorUsername,
    channelId: post.channelId,
    createdAt: post.createdAt,
    id: post.id,
    isDirectMessage,
    mentionedUsernames: extractMentionedUsernames(post.message),
    message: post.message
  };
}

/**
 * §3.8 — what a later turn reads in place of a result: the line rendered from the subject the tool
 * named, else the line the tool wrote itself (a plugin's, or a row from before subjects were
 * stored), else a long result's name and size, else nothing, for a result short enough to be kept
 * as it was. Derived on read rather than stored, so rows written before the default are covered.
 */
export function replayTextOf(payload: PrismaJson.TurnEventPayload): string | undefined {
  if (payload.kind !== 'tool_result') {
    return undefined;
  }
  if (payload.replaySubject !== undefined) {
    return renderReplayLine(payload.replaySubject);
  }
  if (payload.replay !== undefined) {
    return payload.replay;
  }
  const subject = replaySubjectWhenLong(`${renderRecordedToolName(payload.toolName)} result`, payload.output);
  return subject === undefined ? undefined : renderReplayLine(subject);
}
