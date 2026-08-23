import { DEFAULT_TOOL_TIMEOUT_MS } from '@collegium/core/tools';
import type { ToolOutput, ToolResult, ToolTurnScope } from '@collegium/core/tools';
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

import type { ResolvedTool } from './tools.registry.ts';
import type { ToolAttempt } from './tools.types.ts';

type ExecuteInput = {
  /** the turn's event appender, threaded through so the approval trail lands in the trace (§8.3) */
  readonly appendEvent: (event: TurnEventInput) => Promise<void>;
  readonly call: ToolCall;
  readonly profile: AgentProfile;
  readonly turn: ToolTurnScope;
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
    const tool = resolved.value;
    const args = tool.definition.parameters.safeParse(input.call.arguments);
    if (!args.success) {
      // fed back to the model, so the name is spelled as the model spelled it (§1)
      return {
        kind: 'continue',
        output: `invalid arguments for ${tool.wireName}: ${z.prettifyError(args.error)}`
      };
    }
    // the gate is declared by presence (§5), resolved only after a successful parse: malformed args never reach it
    if (!tool.definition.approval) {
      return this.runBody(tool, args.data, input);
    }
    const decision = await this.requestApproval(input, tool, args.data, tool.definition.approval(args.data));
    if (!decision.success) {
      return this.toApprovalFailureAttempt(decision.error);
    }
    return match(decision.value)
      .with({ kind: 'approved' }, () => this.runBody(tool, args.data, input))
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
        detail: `@${byUsername} denied ${tool.displayName}`,
        kind: 'terminal',
        status: 'denied'
      }))
      .with({ kind: 'denied-with-reason' }, ({ reason }): ToolAttempt => ({
        kind: 'continue',
        output: `denied: ${reason}`
      }))
      .exhaustive();
  }

  /** §4 — what the toolset declared and nothing else: services and storage from boot, settings from the acting agent, the turn */
  private assembleContext(tool: ResolvedTool, input: ExecuteInput): { readonly turn: ToolTurnScope } {
    const { declaration, services, storage } = tool.toolset;
    return {
      ...services,
      ...(declaration.settings && { settings: input.profile.toolSettings.get(declaration.name) }),
      ...(declaration.storage && { storage }),
      turn: input.turn
    };
  }

  private requestApproval(
    input: ExecuteInput,
    tool: ResolvedTool,
    args: unknown,
    payload: { body: string; presentation: 'collapse' | 'verbatim' }
  ): Promise<Result<ApprovalDecision, ApprovalFailureRequest>> {
    return this.approvalsService.request({
      agentUsername: input.turn.agentUsername,
      appendEvent: input.appendEvent,
      args,
      channelId: input.turn.channelId,
      payloadPresentation: payload.presentation,
      payloadText: payload.body,
      toolName: tool.id[1],
      toolNamespace: tool.id[0],
      turnId: input.turn.turnId
    });
  }

  private async runBody(tool: ResolvedTool, args: unknown, input: ExecuteInput): Promise<ToolAttempt> {
    const timeoutMs = tool.definition.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    let result: ToolResult;
    try {
      result = await withTimeout(
        Promise.resolve(tool.definition.execute(args, this.assembleContext(tool, input))),
        timeoutMs,
        (): ToolResult => Result.err({ kind: 'timeout', timeoutMs })
      );
    } catch (error) {
      return {
        detail: `${tool.displayName} threw: ${toErrorMessage(error)}`,
        kind: 'terminal',
        status: 'semantic_error'
      };
    }
    if (result.success) {
      return this.toContinueAttempt(result.value);
    }
    return match(result.error)
      .with({ kind: 'exception' }, (failure): ToolAttempt => ({
        detail: failure.message,
        kind: 'terminal',
        status: 'semantic_error'
      }))
      .with({ kind: 'invalid-arguments' }, (failure): ToolAttempt => ({ kind: 'continue', output: failure.message }))
      .with({ kind: 'timeout' }, (failure): ToolAttempt => this.toTimeoutAttempt(tool, failure.timeoutMs))
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

  /** the model receives the text; a disclosure rides beside it for the turn to write out (§3) */
  private toContinueAttempt(output: ToolOutput): ToolAttempt {
    return {
      kind: 'continue',
      output: output.text,
      ...(output.disclosure && { disclosure: output.disclosure })
    };
  }

  /**
   * A timed-out read simply failed, and the model may hear so; a timed-out mutation may have
   * landed, and §7.2 forbids continuing past an unconfirmed side effect — the tool is never
   * re-executed on either branch.
   */
  private toTimeoutAttempt(tool: ResolvedTool, timeoutMs: number): ToolAttempt {
    if (tool.definition.retryable === true) {
      return { kind: 'continue', output: `${tool.wireName} timed out after ${timeoutMs}ms` };
    }
    return {
      detail: `${tool.displayName} timed out after ${timeoutMs}ms and may or may not have taken effect`,
      kind: 'terminal',
      status: 'side_effect_ambiguous'
    };
  }
}
