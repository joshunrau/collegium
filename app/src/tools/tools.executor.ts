import type { Tool } from '@collegium/core/tools';
import { Result, toErrorMessage, withTimeout } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { match } from 'ts-pattern';
import { z } from 'zod';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { ApprovalsService } from '@/approvals/approvals.service.ts';
import type { ApprovalDecision, ApprovalFailureRequest } from '@/approvals/approvals.types.ts';
import type { ToolCall } from '@/inference/inference.types.ts';
import type { TurnEventInput } from '@/turns/turns.types.ts';

import { ToolRegistry } from './tools.registry.ts';

import type { ToolAttempt } from './tools.types.ts';

type ExecuteInput = {
  /** the turn's event appender, threaded through so the approval trail lands in the trace (§8.3) */
  readonly appendEvent: (event: TurnEventInput) => Promise<void>;
  readonly call: ToolCall;
  readonly profile: AgentProfile;
  readonly turn: Tool.TurnScope;
};

/** the executor is where §5.4 lives: gating, denial semantics, and the failure taxonomy */
@Injectable()
export class ToolExecutor {
  constructor(
    private readonly approvalsService: ApprovalsService,
    private readonly toolRegistry: ToolRegistry
  ) {}

  async execute(input: ExecuteInput): Promise<ToolAttempt> {
    const resolved = this.toolRegistry.resolveFor(input.profile, input.call.name);
    if (!resolved.success) {
      return { detail: resolved.error.message, kind: 'terminal', status: 'semantic_error' };
    }
    const definition = resolved.value;
    const args = definition.parameters.safeParse(input.call.arguments);
    if (!args.success) {
      return {
        kind: 'continue',
        output: `invalid arguments for ${definition.name}: ${z.prettifyError(args.error)}`
      };
    }
    // the gate is resolved only after a successful parse: malformed args never reach it (§7.2)
    const requirements = definition.getApprovalRequirements(args.data);
    if (requirements.kind === 'ungated') {
      return this.runBody(definition, args.data, input.turn);
    }
    const decision = await this.requestApproval(input, definition, args.data, requirements.payload);
    if (!decision.success) {
      return this.toApprovalFailureAttempt(decision.error);
    }
    return match(decision.value)
      .with({ kind: 'approved' }, () => this.runBody(definition, args.data, input.turn))
      .with({ kind: 'cancelled' }, ({ reason }): ToolAttempt => {
        const status = match(reason)
          .with('halt', () => 'halted' as const)
          .with('kill', () => 'killed' as const)
          // a live turn can only observe halt/kill/stop; restart cancellations exist for rows a dead process left
          .with('restart', () => 'halted' as const)
          .with('stop', () => 'stopped' as const)
          .exhaustive();
        return { detail: `the pending approval was cancelled by ${reason}`, kind: 'terminal', status };
      })
      .with({ kind: 'denied' }, ({ byUsername }): ToolAttempt => ({
        detail: `@${byUsername} denied ${definition.name}`,
        kind: 'terminal',
        status: 'denied'
      }))
      .with({ kind: 'denied-with-reason' }, ({ reason }): ToolAttempt => ({
        kind: 'continue',
        output: `denied: ${reason}`
      }))
      .exhaustive();
  }

  private requestApproval(
    input: ExecuteInput,
    definition: Tool.Any,
    args: unknown,
    payload: Tool.GatedApprovalPayload
  ): Promise<Result<ApprovalDecision, ApprovalFailureRequest>> {
    return this.approvalsService.request({
      agentUsername: input.turn.agentUsername,
      appendEvent: input.appendEvent,
      args,
      channelId: input.turn.channelId,
      payloadPresentation: payload.presentation,
      payloadText: payload.body,
      toolName: definition.name,
      turnId: input.turn.turnId
    });
  }

  private async runBody(definition: Tool.Any, args: unknown, turn: Tool.TurnScope): Promise<ToolAttempt> {
    let result: Result<Tool.Output, Tool.Failure>;
    try {
      result = await withTimeout(
        Promise.resolve(definition.execute(args, turn)),
        definition.timeoutMs,
        (): Result<Tool.Output, Tool.Failure> => Result.err({ kind: 'timeout', timeoutMs: definition.timeoutMs })
      );
    } catch (error) {
      return {
        detail: `${definition.name} threw: ${toErrorMessage(error)}`,
        kind: 'terminal',
        status: 'semantic_error'
      };
    }
    if (result.success) {
      return { kind: 'continue', output: result.value.text };
    }
    return match(result.error)
      .with({ kind: 'exception' }, (failure): ToolAttempt => ({
        detail: failure.message,
        kind: 'terminal',
        status: 'semantic_error'
      }))
      .with({ kind: 'invalid-arguments' }, (failure): ToolAttempt => ({ kind: 'continue', output: failure.message }))
      .with({ kind: 'timeout' }, (failure): ToolAttempt => this.toTimeoutAttempt(definition, args, failure.timeoutMs))
      .with({ kind: 'unresolved' }, (failure): ToolAttempt => ({
        detail: failure.message,
        kind: 'terminal',
        status: 'side_effect_ambiguous'
      }))
      .with({ kind: 'unknown-tool' }, (failure): ToolAttempt => ({
        detail: failure.message,
        kind: 'terminal',
        status: 'semantic_error'
      }))
      .exhaustive();
  }

  /**
   * §6.2 — an over-long verbatim command was refused before it was ever posted; that is the model's
   * recoverable mistake, so it hears it and continues. Any other undelivered prompt means consent
   * can never arrive, which ends the turn.
   */
  private toApprovalFailureAttempt(failure: ApprovalFailureRequest): ToolAttempt {
    if (failure.kind === 'payload-too-large') {
      return {
        kind: 'continue',
        output: 'the command is too long to present for approval and was refused; shorten it'
      };
    }
    return {
      detail: `the approval prompt could not be delivered: ${JSON.stringify(failure)}`,
      kind: 'terminal',
      status: 'provider_outage'
    };
  }

  /**
   * A timed-out read simply failed, and the model may hear so; a timed-out mutation may have
   * landed, and §7.2 forbids continuing past an unconfirmed side effect — the tool is never
   * re-executed on either branch. The call's own args decide which it was, since a 'dynamic'
   * tool holds both kinds of action behind one name.
   */
  private toTimeoutAttempt(definition: Tool.Any, args: unknown, timeoutMs: number): ToolAttempt {
    if (definition.isRetryable(args)) {
      return { kind: 'continue', output: `${definition.name} timed out after ${timeoutMs}ms` };
    }
    return {
      detail: `${definition.name} timed out after ${timeoutMs}ms and may or may not have taken effect`,
      kind: 'terminal',
      status: 'side_effect_ambiguous'
    };
  }
}
