import type { $AgentDefinition, $PluginName, $TriggerMode, Config } from '@collegium/config';

type AgentSpec = Pick<$AgentDefinition, 'expertise' | 'systemPrompt'> & {
  contextBudgetTokens?: $AgentDefinition['contextBudgetTokens'];
  skills?: $AgentDefinition['skills'];
  tools?: $AgentDefinition['tools'];
  toolSettings?: $AgentDefinition['toolSettings'];
  username: string;
};

type ChannelSpec = {
  /**
   * Agent usernames to add to the channel; every agent when omitted. Naming a subset is what makes
   * the §8.2 obligation testable — that backfill uses each agent's own token and therefore cannot
   * see a channel that agent is not in.
   */
  members?: readonly string[];
  name: string;
  /** how posts in this channel address agents; unlisted means mention-required (§3.10) */
  triggerMode?: $TriggerMode;
  /** a direct channel is between the acting human and its single member, and is respond-to-all by type */
  type?: 'direct' | 'public';
};

type Scenario = {
  agents: readonly AgentSpec[];
  channels: readonly ChannelSpec[];
  /** §4.4; the fixture's window is short enough for every other test, so only debounce tests set this */
  debounce?: Config['app']['debounce'];
  /** plugins written into config.json by name; the harness points PLUGINS_ROOT at the repository's own `plugins/` */
  plugins?: readonly $PluginName[];
  /** the §7.4 framework-wide hourly ceiling; 250 turns is not drivable in a test, so scenarios lower it */
  turnCeilingPerHour?: number;
};

export function defineScenario<const S extends Scenario>(scenario: S): S {
  return scenario;
}

export const DEFAULT_SCENARIO = defineScenario({
  agents: [
    {
      expertise: 'End-to-end testing',
      systemPrompt: 'You are Mira. Reply clearly and briefly.',
      username: 'mira'
    },
    {
      expertise: 'Startup verification',
      systemPrompt: 'You are Owen. Reply clearly and briefly.',
      username: 'owen'
    }
  ],
  channels: [{ name: 'main' }]
});

export type { AgentSpec, ChannelSpec, Scenario };
