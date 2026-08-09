import { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { MailRegistry } from '@/mail/mail.registry.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import { ShellService } from '@/shell/shell.service.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import { WebService } from '@/web/web.service.ts';

import { TOOL_NAMES } from '../tools.constants.ts';
import { TOOL_CLASSES } from '../tools.module.ts';
import { TOOL_LIBRARY_PROVIDER, ToolRegistry } from '../tools.registry.ts';

import type { ToolName } from '../tools.types.ts';

/** gated, because no gated tool ships before the gate itself exists (step 23) */
class GatedFixtureTool extends Tool({
  description: 'a gated fixture',
  name: 'gated_fixture',
  parameters: z.object({ payload: z.string() }),
  timeoutMs: 1000,
  variant: 'gated'
}) {
  execute(): Promise<Tool.Result> {
    return Promise.resolve(Result.ok({ text: 'done' }));
  }

  getApprovalRequirements(args: { payload: string }): Tool.ApprovalRequirements.Gated {
    return { kind: 'gated', payload: { body: args.payload, presentation: 'collapse' } };
  }

  isRetryable(): false {
    return false;
  }

  renderTraceDetail(args: { payload: string }): string {
    return args.payload;
  }
}

/** the qualified name is baked by the SDK factory; core's Tool() with the pre-qualified name stands in for it */
class PluginSaveTool extends Tool({
  description: 'a plugin-contributed fixture',
  name: 'bookmark__save',
  parameters: z.object({}),
  timeoutMs: 1000,
  variant: 'ungated'
}) {
  execute(): Tool.Result {
    return Result.ok({ text: 'saved' });
  }

  getApprovalRequirements(): Tool.ApprovalRequirements.Ungated {
    return { kind: 'ungated' };
  }

  isRetryable(): boolean {
    return true;
  }

  renderTraceDetail(): string {
    return 'save';
  }
}

const profile = (tools: AgentProfile['tools']): AgentProfile => ({
  contextBudgetTokens: 8000,
  expertise: 'programming',
  memoryCaps: { maxBodyChars: 4000, maxDescriptionChars: 200, maxEntries: 50 },
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  skills: [],
  systemPrompt: 'You are Mira Turner',
  tools,
  username: 'mira',
  workspaceDir: '/tmp/workspaces/mira'
});

describe('ToolRegistry', () => {
  let toolRegistry: ToolRegistry;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ...TOOL_CLASSES,
        ToolRegistry,
        MockFactory.createForService(MailRegistry),
        MockFactory.createForService(MemoryService),
        MockFactory.createForService(ShellService),
        MockFactory.createForService(SkillsService),
        MockFactory.createForService(TriggersService),
        MockFactory.createForService(WebService),
        {
          inject: [...TOOL_CLASSES],
          provide: TOOL_LIBRARY_PROVIDER,
          useFactory: (...tools: Tool.Any[]) => [...tools, new GatedFixtureTool(), new PluginSaveTool()]
        }
      ]
    }).compile();
    toolRegistry = moduleRef.get(ToolRegistry);
  });

  it('should resolve a tool inside the agent’s configured set', () => {
    const resolved = toolRegistry.resolveFor(profile(['load_skill']), 'load_skill');
    expect(resolved.value?.name).toBe('load_skill');
  });

  it('should resolve a plugin tool by its qualified name, like any other', () => {
    const resolved = toolRegistry.resolveFor(profile(['bookmark__save']), 'bookmark__save');
    expect(resolved.value?.name).toBe('bookmark__save');
  });

  it('should verify grants against the merged library', () => {
    expect(() => toolRegistry.verifyGrants([profile(['load_skill', 'bookmark__save'])])).not.toThrow();
  });

  it('should refuse to verify a grant that no tool declares, naming the agent', () => {
    expect(() => toolRegistry.verifyGrants([profile(['ghost__tool'])])).toThrow(
      'agent "mira" is configured with "ghost__tool", which no tool in the library declares'
    );
  });

  /**
   * Every provider documents `function.parameters` as an object-typed JSON Schema, and their
   * examples are all `{"type": "object", ...}`. A top-level `oneOf` (what a Zod discriminated
   * union converts to) is rejected as an invalid request, which the framework can only report as
   * an outage — so the shape is asserted here rather than discovered in production.
   */
  it('should describe every tool with an object-typed parameter schema, as providers require', () => {
    const described = toolRegistry.describeFor(profile([...TOOL_NAMES]));
    const offenders = described
      .filter((schema) => (schema.parameters as { type?: string }).type !== 'object')
      .map((schema) => schema.name);
    expect(offenders).toStrictEqual([]);
  });

  it('should reject a name that no tool declares', () => {
    const resolved = toolRegistry.resolveFor(profile(['load_skill']), 'send_mail');
    expect(resolved.error).toStrictEqual({ kind: 'unknown-tool', message: 'no tool named "send_mail" exists' });
  });

  it('should reject a tool outside the agent’s configured set rather than fall back', () => {
    const resolved = toolRegistry.resolveFor(profile(['load_skill']), 'read_memory');
    expect(resolved.error).toStrictEqual({
      kind: 'unknown-tool',
      message: 'agent "mira" is not configured with the tool "read_memory"'
    });
  });

  it('should resolve the gated variant with its approval requirements', () => {
    const definition = toolRegistry.resolveFor(profile(['gated_fixture' as ToolName]), 'gated_fixture').value;
    expect(definition?.variant).toBe('gated');
    expect(definition?.getApprovalRequirements({ payload: 'the full payload' })).toStrictEqual({
      kind: 'gated',
      payload: { body: 'the full payload', presentation: 'collapse' }
    });
  });

  it('should describe a call with the tool’s own summary of its arguments', () => {
    const detail = toolRegistry.describeCall({
      args: { name: 'handing-work-to-a-peer' },
      name: 'load_skill',
      profile: profile(['load_skill'])
    });
    expect(detail).toBe('handing-work-to-a-peer');
  });

  it('should describe nothing for a call the executor will reject', () => {
    const unknown = toolRegistry.describeCall({ args: {}, name: 'send_mail', profile: profile(['load_skill']) });
    const malformed = toolRegistry.describeCall({
      args: { name: 42 },
      name: 'load_skill',
      profile: profile(['load_skill'])
    });
    expect(unknown).toBeUndefined();
    expect(malformed).toBeUndefined();
  });

  it('should refuse a library in which two tools share a name', async () => {
    const fixture = new GatedFixtureTool();
    await expect(
      Test.createTestingModule({
        providers: [ToolRegistry, { provide: TOOL_LIBRARY_PROVIDER, useValue: [fixture, fixture] }]
      }).compile()
    ).rejects.toThrow('two tools in the library share a name');
  });

  it('should fail loudly describing an agent configured with a tool the library never declares', () => {
    expect(() => toolRegistry.describeFor(profile(['send_mail' as ToolName]))).toThrow(
      'agent "mira" is configured with "send_mail", which no tool in the library declares'
    );
  });

  it('should describe exactly the configured set, parameters converted to JSON Schema', () => {
    const schemas = toolRegistry.describeFor(profile(['load_skill', 'read_memory']));
    expect(schemas.map((schema) => schema.name)).toStrictEqual(['load_skill', 'read_memory']);
    expect(schemas[0]?.parameters).toMatchObject({
      properties: { name: { type: 'string' } },
      required: ['name'],
      type: 'object'
    });
  });
});
