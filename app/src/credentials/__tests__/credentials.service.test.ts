import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelToken } from '@/prisma/prisma.utils.ts';

import { CredentialsService } from '../credentials.service.ts';

describe('CredentialsService', () => {
  let credentials: { create: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  let credentialsService: CredentialsService;

  beforeEach(async () => {
    credentials = { create: vi.fn(), findUnique: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [CredentialsService, { provide: getModelToken('MattermostCredential'), useValue: credentials }]
    }).compile();
    credentialsService = moduleRef.get(CredentialsService);
  });

  it('should keep a minted token', async () => {
    credentials.findUnique.mockResolvedValue(null);
    const mint = vi.fn().mockResolvedValue({ token: 'token-1', userId: 'user-1' });
    await expect(credentialsService.ensure({ mint, username: 'jane' })).resolves.toBe('token-1');
    expect(credentials.create).toHaveBeenCalledWith({
      data: { token: 'token-1', userId: 'user-1', username: 'jane' }
    });
  });

  // Mattermost reveals a token once, so a second mint would orphan the one already in use
  it('should never mint a second token for an account that has one', async () => {
    credentials.findUnique.mockResolvedValue({ token: 'token-1' });
    const mint = vi.fn();
    await expect(credentialsService.ensure({ mint, username: 'jane' })).resolves.toBe('token-1');
    expect(mint).not.toHaveBeenCalled();
    expect(credentials.create).not.toHaveBeenCalled();
  });

  it('should refuse to answer for an account provisioning has not reached', async () => {
    credentials.findUnique.mockResolvedValue(null);
    await expect(credentialsService.require('jane')).rejects.toThrow('no provisioned Mattermost token');
  });
});
