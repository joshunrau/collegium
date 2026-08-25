import { defineToolset } from '@collegium/core/toolsets';
import type { AnyToolset } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { SKILLS_TOOLSET } from '@/skills/skills.toolset.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { TRIGGERS_TOOLSET } from '@/triggers/triggers.toolset.ts';

import { ToolRegistry } from '../tools.registry.ts';

import type { RegisteredToolset } from '../tools.registry.ts';

const NOTES_TOOLSET = defineToolset({
  name: 'notes',
  tools: {
    add: {
      description: 'Add a note.',
      execute: () => Result.ok({ text: 'added' }),
      parameters: z.object({ text: z.string() }),
      traceDetail: (args) => args.text
    },
    list: { description: 'List notes.', execute: () => Result.ok({ text: 'none' }), parameters: z.object({}) }
  }
});

const register = (declaration: AnyToolset): RegisteredToolset => ({ declaration, services: {}, storage: {} });

const LIBRARY = [SKILLS_TOOLSET, TRIGGERS_TOOLSET, NOTES_TOOLSET].map(register);

describe('ToolRegistry', () => {
  it('expands a namespace grant to every tool it holds, keyed by wire name', () => {
    const profile = buildAgentProfile({ tools: ['notes'] });
    const registry = new ToolRegistry(LIBRARY, [profile]);
    expect(registry.describeFor(profile).map((schema) => schema.name)).toStrictEqual([
      'skills__load',
      'triggers__resolve',
      'notes__add',
      'notes__list'
    ]);
  });

  it('grants a single tool by its ref, leaving the rest of the namespace out', () => {
    const profile = buildAgentProfile({ tools: ['notes::list'] });
    const registry = new ToolRegistry(LIBRARY, [profile]);
    const names = registry.describeFor(profile).map((schema) => schema.name);
    expect(names).toContain('notes__list');
    expect(names).not.toContain('notes__add');
  });

  it('includes the core tools for an agent granted nothing (§8)', () => {
    const profile = buildAgentProfile();
    const registry = new ToolRegistry(LIBRARY, [profile]);
    expect(registry.describeFor(profile).map((schema) => schema.name)).toStrictEqual([
      'skills__load',
      'triggers__resolve'
    ]);
  });

  it('refuses a grant naming a core capability (§8)', () => {
    expect(() => new ToolRegistry(LIBRARY, [buildAgentProfile({ tools: ['skills'] })])).toThrow(
      'which is core — always enabled and never granted'
    );
    expect(() => new ToolRegistry(LIBRARY, [buildAgentProfile({ tools: ['skills::load'] })])).toThrow(
      'which is core — always enabled and never granted'
    );
  });

  it('refuses a grant nothing declares, naming the agent (§6.1)', () => {
    expect(() => new ToolRegistry(LIBRARY, [buildAgentProfile({ tools: ['ghost'] })])).toThrow(
      'agent "mira" is configured with "ghost", which no toolset in the library declares'
    );
  });

  it('refuses two toolsets claiming one namespace (§1)', () => {
    expect(() => new ToolRegistry([...LIBRARY, register(NOTES_TOOLSET)], [])).toThrow(
      'two toolsets claim the namespace "notes"'
    );
  });

  it('resolves a wire name inside the agent’s set and refuses one outside it, never falling back (§6.1)', () => {
    const granted = buildAgentProfile({ tools: ['notes'] });
    const ungranted = buildAgentProfile({ username: 'owen' });
    const registry = new ToolRegistry(LIBRARY, [granted, ungranted]);
    expect(registry.resolveFor(granted, 'notes__add').unwrap().displayName).toBe('notes::add');
    expect(registry.resolveFor(ungranted, 'notes__add').error).toMatchObject({ kind: 'unknown-tool' });
    expect(registry.resolveFor(granted, 'does_not_exist').error).toMatchObject({ kind: 'unknown-tool' });
  });

  it('describes a call with its display name and the tool’s own detail (§8.1)', () => {
    const profile = buildAgentProfile({ tools: ['notes'] });
    const registry = new ToolRegistry(LIBRARY, [profile]);
    expect(registry.describeCall({ args: { text: 'buy milk' }, name: 'notes__add', profile })).toStrictEqual({
      detail: 'buy milk',
      displayName: 'notes::add',
      id: ['notes', 'add']
    });
  });

  it('describes a malformed call by name alone, and an unknown call not at all', () => {
    const profile = buildAgentProfile({ tools: ['notes'] });
    const registry = new ToolRegistry(LIBRARY, [profile]);
    expect(registry.describeCall({ args: { text: 5 }, name: 'notes__add', profile })).toMatchObject({
      detail: undefined,
      displayName: 'notes::add'
    });
    expect(registry.describeCall({ args: {}, name: 'ghost__tool', profile })).toBeUndefined();
  });

  it('answers budget exemption from the tool’s own declaration, never for an unknown name (§5.3)', () => {
    const profile = buildAgentProfile();
    const registry = new ToolRegistry(LIBRARY, [profile]);
    expect(registry.isBudgetExempt(profile, 'skills__load')).toBe(true);
    expect(registry.isBudgetExempt(profile, 'triggers__resolve')).toBe(false);
    expect(registry.isBudgetExempt(profile, 'ghost')).toBe(false);
  });
});
