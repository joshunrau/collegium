import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImapMailProvider } from '../imap.provider.ts';

const client = vi.hoisted(() => ({
  connect: vi.fn(),
  fetchOne: vi.fn(),
  getMailboxLock: vi.fn(),
  logout: vi.fn(),
  mailbox: { exists: 3, uidNext: 43, uidValidity: 7n },
  messageFlagsAdd: vi.fn(),
  search: vi.fn()
}));

vi.mock('imapflow', () => ({
  ImapFlow: class {
    constructor() {
      return client;
    }
  }
}));

const EML = ['From: a@acme.com', 'Subject: Fresh', 'Date: Thu, 30 Jul 2026 12:00:00 +0000', '', 'hello', ''].join(
  '\r\n'
);

describe('ImapMailProvider cursor', () => {
  let provider: ImapMailProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    client.connect.mockResolvedValue(undefined);
    client.getMailboxLock.mockResolvedValue({ release: vi.fn() });
    client.logout.mockResolvedValue(undefined);
    client.mailbox = { exists: 3, uidNext: 43, uidValidity: 7n };
    provider = new ImapMailProvider({
      address: 'tess@example.org',
      imap: { host: 'imap.example.org', port: 993, secure: true },
      kind: 'imap',
      password: 'password_1',
      smtp: { host: 'smtp.example.org', port: 587, secure: false },
      username: 'tess'
    });
  });

  it('should initialize at UIDNEXT, announcing nothing', async () => {
    const initialized = await provider.initializeCursor();
    expect(JSON.parse(initialized.value!)).toStrictEqual({ uidNext: 43, uidValidity: '7' });
    expect(client.search).not.toHaveBeenCalled();
  });

  it('should announce arrivals at or past the cursor and advance past the last one returned', async () => {
    client.search.mockResolvedValue([43, 44]);
    client.fetchOne.mockResolvedValue({ source: Buffer.from(EML), uid: 43 });
    const polled = await provider.pollNew(JSON.stringify({ uidNext: 43, uidValidity: '7' }), 25);
    expect(polled.value?.messages).toHaveLength(2);
    expect(polled.value?.messages[0]).toMatchObject({
      ref: '7:43',
      sender: { address: 'a@acme.com' },
      subject: 'Fresh'
    });
    expect(JSON.parse(polled.value!.cursor)).toStrictEqual({ uidNext: 45, uidValidity: '7' });
  });

  it('should ignore the newest-message echo of an empty range and keep the cursor still', async () => {
    // IMAP answers `43:*` with the newest message even when nothing is ≥ 43
    client.search.mockResolvedValue([42]);
    const polled = await provider.pollNew(JSON.stringify({ uidNext: 43, uidValidity: '7' }), 25);
    expect(polled.value?.messages).toStrictEqual([]);
    expect(JSON.parse(polled.value!.cursor)).toStrictEqual({ uidNext: 43, uidValidity: '7' });
    expect(client.fetchOne).not.toHaveBeenCalled();
  });

  it('should report a UIDVALIDITY change as cursor-reset', async () => {
    client.mailbox = { exists: 3, uidNext: 43, uidValidity: 8n };
    const polled = await provider.pollNew(JSON.stringify({ uidNext: 43, uidValidity: '7' }), 25);
    expect(polled.error).toMatchObject({ kind: 'cursor-reset' });
  });
});
