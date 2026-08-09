import type { AgentProfile } from '@/agents/agents.types.ts';
import type { ChatTransport } from '@/chat/chat.transport.ts';

export type RunningAgent = {
  profile: AgentProfile;
  transport: ChatTransport;
};
