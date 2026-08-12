import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelToken } from '@/prisma/prisma.utils.ts';

import { CredentialsService } from '../credentials.service.ts';

describe('CredentialsService', () => {
  let credentials: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  let credentialsService: CredentialsService;

  beforeEach(async () => {
    credentials = { findUnique: vi.fn(), upsert: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [CredentialsService, { provide: getModelToken('MattermostCredential'), useValue: credentials }]
    }).compile();
    credentialsService = moduleRef.get(CredentialsService);
  });

  it('should keep a minted token', async () => {
    credentials.findUnique.mockResolvedValue(null);
    const mint = vi.fn().mockResolvedValue('token-1');
    await expect(credentialsService.ensure({ mint, userId: 'user-1', username: 'jane' })).resolves.toBe('token-1');
    expect(credentials.upsert).toHaveBeenCalledWith({
      create: { token: 'token-1', userId: 'user-1', username: 'jane' },
      update: { token: 'token-1', userId: 'user-1' },
      where: { username: 'jane' }
    });
  });

  // Mattermost reveals a token once, so minting again would orphan the one already in use
  it('should not mint while the held token still names the ensured account', async () => {
    credentials.findUnique.mockResolvedValue({ token: 'token-1', userId: 'user-1' });
    const mint = vi.fn();
    await expect(credentialsService.ensure({ mint, userId: 'user-1', username: 'jane' })).resolves.toBe('token-1');
    expect(mint).not.toHaveBeenCalled();
    expect(credentials.upsert).not.toHaveBeenCalled();
  });

  it('should replace a token whose userId no longer matches the ensured account', async () => {
    credentials.findUnique.mockResolvedValue({ token: 'token-1', userId: 'user-1' });
    const mint = vi.fn().mockResolvedValue('token-2');
    await expect(credentialsService.ensure({ mint, userId: 'user-2', username: 'jane' })).resolves.toBe('token-2');
    expect(credentials.upsert).toHaveBeenCalledWith({
      create: { token: 'token-2', userId: 'user-2', username: 'jane' },
      update: { token: 'token-2', userId: 'user-2' },
      where: { username: 'jane' }
    });
  });

  it('should refuse to answer for an account provisioning has not reached', async () => {
    credentials.findUnique.mockResolvedValue(null);
    await expect(credentialsService.require('jane')).rejects.toThrow('no provisioned Mattermost token');
  });
});
