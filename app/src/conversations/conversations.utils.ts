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
