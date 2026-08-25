import { defineToolset } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { resolveEffectiveToolSettings, resolveGrantedToolsetSettings } from '../tools.settings.ts';

const NOTES_TOOLSET = defineToolset({
  name: 'notes',
  settings: z.strictObject({
    flavor: z.enum(['plain', 'fancy']).default('plain'),
    provider: z.strictObject({ kind: z.string(), token: z.string() }).optional()
  }),
  tools: {
    add: { description: 'Add a note.', execute: () => Result.ok({ text: 'ok' }), parameters: z.object({}) }
  }
});

const PLAIN_TOOLSET = defineToolset({
  name: 'plain',
  tools: {
    noop: { description: 'Does nothing.', execute: () => Result.ok({ text: 'ok' }), parameters: z.object({}) }
  }
});

const REQUIRING_TOOLSET = defineToolset({
  name: 'requiring',
  settings: z.strictObject({ address: z.string() }),
  tools: {
    use: { description: 'Uses the address.', execute: () => Result.ok({ text: 'ok' }), parameters: z.object({}) }
  }
});

const TOOLSETS = [NOTES_TOOLSET, PLAIN_TOOLSET, REQUIRING_TOOLSET];

function resolve(input: {
  agents?: { tools?: string[]; toolSettings?: { [key: string]: unknown }; username?: string }[];
  defaults?: { [key: string]: unknown };
}) {
  return resolveEffectiveToolSettings({
    agents: (input.agents ?? []).map((agent) => ({
      tools: agent.tools ?? [],
      toolSettings: agent.toolSettings ?? {},
      username: agent.username ?? 'mira'
    })),
    defaults: input.defaults ?? {},
    toolsets: TOOLSETS
  });
}

describe('resolveEffectiveToolSettings', () => {
  it('parses defaulted settings for a granted toolset with nothing supplied', () => {
    const resolved = resolve({ agents: [{ tools: ['notes'] }] });
    expect(resolved.get('mira')?.get('notes')).toStrictEqual({ flavor: 'plain' });
  });

  it('merges app defaults under the agent’s own settings, shallowly', () => {
    const resolved = resolve({
      agents: [
        { tools: ['notes'], toolSettings: { notes: { provider: { kind: 'b', token: 't2' } } } },
        { tools: ['notes'], username: 'owen' }
      ],
      defaults: { notes: { flavor: 'fancy', provider: { kind: 'a', token: 't1' } } }
    });
    // shallow: the agent's provider replaces the default whole rather than half-merging it
    expect(resolved.get('mira')?.get('notes')).toStrictEqual({
      flavor: 'fancy',
      provider: { kind: 'b', token: 't2' }
    });
    expect(resolved.get('owen')?.get('notes')).toStrictEqual({ flavor: 'fancy', provider: { kind: 'a', token: 't1' } });
  });

  it('counts a single-tool grant as granting the toolset', () => {
    const resolved = resolve({ agents: [{ tools: ['notes::add'], toolSettings: { notes: { flavor: 'fancy' } } }] });
    expect(resolved.get('mira')?.get('notes')).toStrictEqual({ flavor: 'fancy' });
  });

  it('rejects a granted toolset whose merged settings fail its schema, naming the agent', () => {
    expect(() => resolve({ agents: [{ tools: ['requiring'] }] })).toThrow(
      'agent "mira" has invalid settings for "requiring"'
    );
  });

  it('rejects settings for a toolset the agent is not granted', () => {
    expect(() => resolve({ agents: [{ toolSettings: { notes: {} } }] })).toThrow(
      'agent "mira" supplies toolSettings for "notes" without being granted any of its tools'
    );
  });

  it('rejects settings for a toolset nothing declares', () => {
    expect(() => resolve({ agents: [{ toolSettings: { ghost: {} } }] })).toThrow(
      'agent "mira" supplies toolSettings for "ghost", which no toolset declares'
    );
    expect(() => resolve({ defaults: { ghost: {} } })).toThrow(
      'defaultToolSettings names "ghost", which no toolset declares'
    );
  });

  it('rejects settings for a toolset that declares no settings schema', () => {
    expect(() => resolve({ agents: [{ tools: ['plain'], toolSettings: { plain: {} } }] })).toThrow(
      'agent "mira" supplies toolSettings for "plain", which declares no settings schema'
    );
    expect(() => resolve({ defaults: { plain: {} } })).toThrow(
      'defaultToolSettings supplies settings for "plain", which declares no settings schema'
    );
  });

  it('rejects a settings value that is not an object', () => {
    expect(() => resolve({ agents: [{ tools: ['notes'], toolSettings: { notes: 5 } }] })).toThrow('must be an object');
  });
});

describe('resolveGrantedToolsetSettings', () => {
  it('resolves one toolset for one agent, typed by its schema', () => {
    const agent = { tools: ['notes'], toolSettings: { notes: { flavor: 'fancy' } }, username: 'mira' };
    const settings = resolveGrantedToolsetSettings(NOTES_TOOLSET, { agent, defaults: {} });
    expect(settings).toStrictEqual({ flavor: 'fancy' });
  });

  it('answers undefined for an agent granted none of the toolset’s tools', () => {
    const agent = { tools: [], toolSettings: {}, username: 'mira' };
    expect(resolveGrantedToolsetSettings(NOTES_TOOLSET, { agent, defaults: {} })).toBeUndefined();
  });
});
