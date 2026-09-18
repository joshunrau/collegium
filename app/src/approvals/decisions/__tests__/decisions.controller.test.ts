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

import { ApprovalsService } from '../../approvals.service.ts';
import { DecisionsController } from '../decisions.controller.ts';

describe('DecisionsController', () => {
  let approvalsService: MockedInstance<ApprovalsService>;
  let decisionsController: DecisionsController;
  let signer: CallbackSigner;

  beforeEach(async () => {
    approvalsService = MockFactory.createMock(ApprovalsService);
    approvalsService.decide.mockResolvedValue(Result.ok());
    approvalsService.decideWithReason.mockResolvedValue(Result.ok());
    const moduleRef = await Test.createTestingModule({
      controllers: [DecisionsController],
      providers: [
        CallbackSigner,
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: EnvService, useValue: createEnvServiceMock({ CALLBACK_TOKEN: 'k'.repeat(32) }) },
        MockFactory.createForService(LoggingService)
      ]
    }).compile();
    decisionsController = moduleRef.get(DecisionsController);
    signer = moduleRef.get(CallbackSigner);
  });

  const click = (action: 'approve' | 'deny', signature: string) => ({
    context: { action, approval_id: 'approval-1', signature },
    user_id: 'casey-id',
    user_name: 'casey'
  });

  it('should resolve a click whose signature was minted for this approval and action (§6.4)', async () => {
    await decisionsController.decide(click('approve', signer.sign(['decision', 'approval-1', 'approve'])));
    expect(approvalsService.decide).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: 'approve', approvalId: 'approval-1', byUsername: 'casey' })
    );
  });

  it('should refuse a click carrying a forged signature, or one minted for another action (§6.4)', async () => {
    await expect(decisionsController.decide(click('approve', 'forged'))).rejects.toThrow(UnauthorizedException);
    await expect(
      decisionsController.decide(click('deny', signer.sign(['decision', 'approval-1', 'approve'])))
    ).rejects.toThrow(UnauthorizedException);
    expect(approvalsService.decide).not.toHaveBeenCalled();
  });

  it('should refuse a dialog submission whose state names a signature for another decider (§6.4)', async () => {
    const state = JSON.stringify({ byUsername: 'mallory', signature: signer.sign(['reason', 'approval-1', 'casey']) });
    await expect(
      decisionsController.submitReason({
        callback_id: 'approval-1',
        state,
        submission: { reason: 'no' },
        user_id: 'mallory-id'
      })
    ).rejects.toThrow(UnauthorizedException);
    expect(approvalsService.decideWithReason).not.toHaveBeenCalled();
  });
});
