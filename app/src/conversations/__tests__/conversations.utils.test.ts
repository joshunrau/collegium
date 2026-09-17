import { describe, expect, it } from 'vitest';

import { renderPostWithAttachments } from '../conversations.utils.ts';

const post = (attachments: null | PrismaJson.PostAttachments) => ({ attachments, message: 'what do you think?' });

describe('renderPostWithAttachments', () => {
  it('should render one line per attached file', () => {
    const files = [
      { id: 'file-1', mimeType: 'application/pdf', name: 'q3-report.pdf', size: 421888 },
      { id: 'file-2', mimeType: 'text/csv', name: 'rows.csv', size: 12 }
    ];
    expect(renderPostWithAttachments(post({ files }))).toBe(
      'what do you think?\n[attached: q3-report.pdf (application/pdf, 421888 bytes)]\n[attached: rows.csv (text/csv, 12 bytes)]'
    );
  });

  it('should say the name is unavailable when metadata was absent', () => {
    const files = [{ id: 'file-1', mimeType: '', name: '', size: 0 }];
    expect(renderPostWithAttachments(post({ files }))).toBe('what do you think?\n[1 file attached, name unavailable]');
  });

  it('should render nothing when a post carried no files', () => {
    expect(renderPostWithAttachments(post(null))).toBe('what do you think?');
  });
});
