import { describe, expect, it } from 'vitest';

import { $MattermostPostedEventMessage } from '../mattermost.schemas.ts';

const postedEvent = (post: { [key: string]: unknown }) => ({
  data: {
    channel_type: 'O',
    post: JSON.stringify({
      channel_id: 'channel-1',
      create_at: 1700000000000,
      id: 'post-1',
      message: '',
      type: '',
      ...post
    }),
    sender_name: '@casey'
  },
  event: 'posted'
});

describe('$MattermostPostedEventMessage', () => {
  it('should parse a post carrying file ids and file metadata', () => {
    const parsed = $MattermostPostedEventMessage.parse(
      postedEvent({
        file_ids: ['file-1'],
        metadata: { files: [{ id: 'file-1', mime_type: 'application/pdf', name: 'q3-report.pdf', size: 421888 }] }
      })
    );
    expect(parsed.data.post.fileIds).toStrictEqual(['file-1']);
    expect(parsed.data.post.metadata.files).toStrictEqual([
      { id: 'file-1', mimeType: 'application/pdf', name: 'q3-report.pdf', size: 421888 }
    ]);
  });

  it('should parse a post carrying file ids with no metadata', () => {
    const parsed = $MattermostPostedEventMessage.parse(postedEvent({ file_ids: ['file-1'] }));
    expect(parsed.data.post.metadata.files).toStrictEqual([]);
  });

  it('should parse a post carrying no files', () => {
    expect($MattermostPostedEventMessage.parse(postedEvent({})).data.post.fileIds).toStrictEqual([]);
  });
});
