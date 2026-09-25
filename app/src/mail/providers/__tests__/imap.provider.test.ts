import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImapMailProvider } from '../imap.provider.ts';

const clients = vi.hoisted((): FakeImapFlow[] => []);

class FakeImapFlow extends EventEmitter {
  private rejectPending: ((error: Error) => void) | undefined;
  close = vi.fn(() => this.rejectPending?.(new Error('Connection not available')));

  connect = vi.fn(() => Promise.resolve());
  fetchOne = vi.fn(() => {
    return new Promise((_resolve, reject) => {
      this.rejectPending = reject;
      setTimeout(() => this.emit('error', new Error('read ECONNRESET')), 0);
    });
  });
  getMailboxLock = vi.fn(() => Promise.resolve({ release: vi.fn() }));
  logout = vi.fn(() => Promise.reject(new Error('Connection not available')));
  readonly mailbox = { exists: 3, uidNext: 43, uidValidity: 7n };
}

vi.mock('imapflow', () => ({
  ImapFlow: class {
    constructor() {
      const client = new FakeImapFlow();
      clients.push(client);
      return client;
    }
  }
}));

describe('ImapMailProvider', () => {
  const logger = { warn: vi.fn() };
  let provider: ImapMailProvider;

  beforeEach(() => {
    clients.length = 0;
    logger.warn.mockClear();
    provider = new ImapMailProvider(
      {
        address: 'tess@example.org',
        imap: { host: 'imap.example.org', password: 'password_1', port: 993, secure: true, username: 'tess' },
        kind: 'imap',
        smtp: { host: 'smtp.example.org', password: 'password_2', port: 587, secure: false, username: 'tess' }
      },
      logger
    );
  });

  it('should fail the pending call, not the process, when the connection errors after connect (§3.13)', async () => {
    const read = await provider.getConversation('7:42');
    expect(read).toMatchObject({ error: { kind: 'provider-unavailable' }, success: false });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('read ECONNRESET'));
    expect(clients[0]?.close).toHaveBeenCalledOnce();
  });

  it('should open a fresh client for the next call after a connection error', async () => {
    await provider.getConversation('7:42');
    await provider.getConversation('7:42');
    expect(clients).toHaveLength(2);
  });
});
