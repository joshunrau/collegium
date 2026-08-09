import { simpleParser } from 'mailparser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImapMailProvider } from '../imap.provider.ts';

const sendMail = vi.hoisted(() => vi.fn());

vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

const client = vi.hoisted(() => ({
  append: vi.fn(),
  connect: vi.fn(),
  fetchOne: vi.fn(),
  getMailboxLock: vi.fn(),
  list: vi.fn(),
  logout: vi.fn(),
  mailbox: { exists: 3, uidNext: 43, uidValidity: 7n },
  search: vi.fn()
}));

vi.mock('imapflow', () => ({
  ImapFlow: class {
    constructor() {
      return client;
    }
  }
}));

const ORIGINAL_EML = [
  'From: billing@acme.com',
  'Subject: Invoice overdue',
  'Date: Thu, 30 Jul 2026 12:00:00 +0000',
  'Message-ID: <original@acme.com>',
  'References: <root@acme.com>',
  '',
  'original body',
  ''
].join('\r\n');

const OUTBOUND = {
  body: 'The invoice is scheduled for Friday.',
  cc: ['ops@example.org'],
  subject: 'Re: Invoice overdue',
  to: ['billing@acme.com']
} as const;

const sentRaw = async () => {
  const raw: unknown = sendMail.mock.calls[0]?.[0]?.raw;
  if (!Buffer.isBuffer(raw)) {
    expect.fail('expected a raw message buffer');
  }
  return simpleParser(raw);
};

describe('ImapMailProvider outbound', () => {
  let provider: ImapMailProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    client.connect.mockResolvedValue(undefined);
    client.getMailboxLock.mockResolvedValue({ release: vi.fn() });
    client.list.mockResolvedValue([{ path: 'Sent Items', specialUse: '\\Sent' }]);
    client.logout.mockResolvedValue(undefined);
    sendMail.mockResolvedValue({});
    provider = new ImapMailProvider({
      address: 'tess@example.org',
      imap: { host: 'imap.example.org', port: 993, secure: true },
      kind: 'imap',
      password: 'password_1',
      smtp: { host: 'smtp.example.org', port: 587, secure: false },
      username: 'tess'
    });
  });

  it('should send exactly the approved content under an explicit envelope, copying it to Sent', async () => {
    expect((await provider.send(OUTBOUND)).success).toBe(true);
    const parsed = await sentRaw();
    expect(parsed.subject).toBe('Re: Invoice overdue');
    expect(parsed.text).toBe('The invoice is scheduled for Friday.\n');
    expect(sendMail.mock.calls[0]?.[0]?.envelope).toStrictEqual({
      from: 'tess@example.org',
      to: ['billing@acme.com', 'ops@example.org']
    });
    expect(client.append).toHaveBeenCalledWith('Sent Items', expect.any(Buffer), ['\\Seen']);
  });

  it('should thread a reply from the original message headers', async () => {
    client.fetchOne.mockResolvedValue({ source: Buffer.from(ORIGINAL_EML), uid: 42 });
    expect((await provider.reply('7:42', OUTBOUND)).success).toBe(true);
    const parsed = await sentRaw();
    expect(parsed.inReplyTo).toBe('<original@acme.com>');
    expect([parsed.references].flat()).toStrictEqual(['<root@acme.com>', '<original@acme.com>']);
  });

  it('should report an SMTP response code as refused — nothing left', async () => {
    sendMail.mockRejectedValue(Object.assign(new Error('550 5.7.708 denied'), { responseCode: 550 }));
    expect((await provider.send(OUTBOUND)).error).toMatchObject({ kind: 'send-refused' });
  });

  it('should report refused credentials as auth', async () => {
    sendMail.mockRejectedValue(Object.assign(new Error('invalid login'), { code: 'EAUTH' }));
    expect((await provider.send(OUTBOUND)).error).toMatchObject({ kind: 'auth' });
  });

  it('should report a socket dying mid-send as unresolved, never as a failure', async () => {
    sendMail.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ESOCKET' }));
    expect((await provider.send(OUTBOUND)).error).toMatchObject({ kind: 'send-unresolved' });
  });

  it('should keep a completed send successful when the Sent copy fails', async () => {
    client.append.mockRejectedValue(new Error('no such mailbox'));
    expect((await provider.send(OUTBOUND)).success).toBe(true);
  });
});
