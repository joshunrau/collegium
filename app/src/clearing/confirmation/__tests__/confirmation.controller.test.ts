import { Result } from '@collegium/core/utils';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { CallbackSigner } from '@/chat/callback-auth/callback-signer.service.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { createEnvServiceMock } from '@/testing/factories/env-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ClearingService } from '../../clearing.service.ts';
import { ConfirmationController } from '../confirmation.controller.ts';

const STATE = { byUsername: 'casey', channelId: 'channel-1', issuedAt: '2026-09-19T12:00:00.000Z', memories: true };

describe('ConfirmationController', () => {
  let callbackSigner: CallbackSigner;
  let clearingService: MockedInstance<ClearingService>;
  let confirmationController: ConfirmationController;
  let loggingService: MockedInstance<LoggingService>;

  const submission = (state: object, overrides: object = {}) => ({
    callback_id: 'channel-1',
    channel_id: 'channel-1',
    state: JSON.stringify(state),
    submission: {},
    user_id: 'casey-id',
    ...overrides
  });

  /** the state as the command would have signed it */
  const signed = () => ({
    ...STATE,
    signature: callbackSigner.sign(['clear', 'channel-1', 'casey', STATE.issuedAt, 'memories'])
  });

  beforeEach(async () => {
    clearingService = MockFactory.createMock(ClearingService);
    clearingService.confirm.mockResolvedValue(Result.ok());
    loggingService = MockFactory.createMock(LoggingService);
    const moduleRef = await Test.createTestingModule({
      controllers: [ConfirmationController],
      providers: [
        CallbackSigner,
        { provide: ClearingService, useValue: clearingService },
        { provide: EnvService, useValue: createEnvServiceMock({ CALLBACK_TOKEN: 'k'.repeat(32) }) },
        { provide: LoggingService, useValue: loggingService }
      ]
    }).compile();
    callbackSigner = moduleRef.get(CallbackSigner);
    confirmationController = moduleRef.get(ConfirmationController);
  });

  it('should do nothing for a cancelled dialog', async () => {
    expect(await confirmationController.confirm(submission(signed(), { cancelled: true }))).toStrictEqual({});
    expect(clearingService.confirm).not.toHaveBeenCalled();
  });

  it('should refuse a state whose signature does not verify, logging it (§6.4)', async () => {
    const tampered = { ...signed(), memories: false };
    await expect(confirmationController.confirm(submission(tampered))).rejects.toThrow(UnauthorizedException);
    expect(clearingService.confirm).not.toHaveBeenCalled();
    expect(loggingService.warn).toHaveBeenCalledOnce();
  });

  it('should hand the signed request to the clear, and nothing the submission says beside it', async () => {
    expect(await confirmationController.confirm(submission(signed(), { channel_id: 'channel-9' }))).toStrictEqual({});
    expect(clearingService.confirm).toHaveBeenCalledExactlyOnceWith(STATE);
  });

  it('should show the dialog why a clear was refused', async () => {
    clearingService.confirm.mockResolvedValue(Result.err({ kind: 'expired' }));
    expect(await confirmationController.confirm(submission(signed()))).toStrictEqual({
      error: 'This confirmation has expired. Run /collegium clear again.'
    });
  });
});
