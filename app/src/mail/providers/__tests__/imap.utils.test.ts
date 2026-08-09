import { simpleParser } from 'mailparser';
import { describe, expect, it } from 'vitest';

import {
  parseImapCursor,
  parseImapRef,
  serializeImapCursor,
  serializeImapRef,
  toMailMessage,
  toPreview
} from '../imap.utils.ts';

const HTML_EML = [
  'From: Acme Billing <billing@acme.com>',
  'To: Tess Rivera <tess.rivera@example.org>',
  'Cc: ops@example.org',
  'Subject: Invoice overdue',
  'Date: Thu, 30 Jul 2026 12:00:00 +0000',
  'Message-ID: <original@acme.com>',
  'Content-Type: multipart/mixed; boundary="frontier"',
  '',
  '--frontier',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Hello <b>world</b></p>',
  '--frontier',
  'Content-Type: application/pdf; name="invoice.pdf"',
  'Content-Disposition: attachment; filename="invoice.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  'JVBERi0xLjQ=',
  '--frontier--',
  ''
].join('\r\n');

const TEXT_EML = [
  'From: billing@acme.com',
  'Subject: Plain words',
  'Date: Thu, 30 Jul 2026 12:00:00 +0000',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Just plain text.',
  ''
].join('\r\n');

describe('toMailMessage', () => {
  it('should render an HTML part as markdown and describe the attachment without content', async () => {
    const message = toMailMessage(await simpleParser(HTML_EML), '7:42', false);
    expect(message).toMatchObject({
      attachments: [{ name: 'invoice.pdf', type: 'application/pdf' }],
      body: 'Hello **world**',
      cc: [{ address: 'ops@example.org' }],
      ref: '7:42',
      sender: { address: 'billing@acme.com', name: 'Acme Billing' },
      subject: 'Invoice overdue',
      to: [{ address: 'tess.rivera@example.org', name: 'Tess Rivera' }]
    });
  });

  it('should pass a plain-text body through untouched', async () => {
    const message = toMailMessage(await simpleParser(TEXT_EML), '7:43', true);
    expect(message.body).toBe('Just plain text.\n');
    expect(message.isRead).toBe(true);
    expect(message.attachments).toStrictEqual([]);
  });
});

describe('refs and cursors', () => {
  it('should round-trip a ref and refuse a shape it never issued', () => {
    const ref = serializeImapRef(7n, 42);
    expect(parseImapRef(ref).value).toStrictEqual({ uid: 42, uidValidity: '7' });
    expect(parseImapRef('graph-style-ref').error).toMatchObject({ kind: 'not-found' });
  });

  it('should round-trip a cursor and report an unreadable one as cursor-reset', () => {
    const cursor = serializeImapCursor({ uidNext: 43, uidValidity: '7' });
    expect(parseImapCursor(cursor).value).toStrictEqual({ uidNext: 43, uidValidity: '7' });
    expect(parseImapCursor('not json').error).toMatchObject({ kind: 'cursor-reset' });
  });
});

describe('toPreview', () => {
  it('should collapse whitespace and bound the excerpt', () => {
    expect(toPreview('line one\n\n  line two')).toBe('line one line two');
    expect(toPreview('x'.repeat(500))).toHaveLength(140);
  });
});
