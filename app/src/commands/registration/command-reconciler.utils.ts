import type { RegisteredSlashCommand, SlashCommandRegistration, SlashCommandSurface } from '@/chat/chat.types.ts';

function matchesRegistration(command: RegisteredSlashCommand, registration: SlashCommandRegistration): boolean {
  return (
    command.autoComplete &&
    command.autoCompleteHint === registration.autoCompleteHint &&
    command.description === registration.description &&
    command.displayName === registration.displayName &&
    // a hand-edited GET command 404s against the POST-only controller — exactly the drift this heals
    command.method === 'P' &&
    command.url === registration.url
  );
}

export type SlashCommandReconciliationPlan = {
  /** desired triggers held by accounts this app does not own — unresolvable, boot refuses (§8.4) */
  readonly collisions: readonly RegisteredSlashCommand[];
  /** owned commands whose managed fields drifted — the redeploy case §8.4 exists for */
  readonly corrections: readonly { commandId: string; registration: SlashCommandRegistration }[];
  /** desired triggers no command currently holds */
  readonly creates: readonly SlashCommandRegistration[];
  /** owned commands whose trigger left the desired list */
  readonly deletes: readonly RegisteredSlashCommand[];
};

/**
 * §8.4 as pure data: ownership is the creating account, never the trigger word or the URL. A
 * command this app created is its own to correct or remove; anyone else's is never touched.
 */
export function planSlashCommandReconciliation(input: {
  desired: readonly SlashCommandRegistration[];
  surface: SlashCommandSurface;
}): SlashCommandReconciliationPlan {
  const desiredByTrigger = new Map(input.desired.map((registration) => [registration.trigger, registration]));
  const owned = input.surface.commands.filter((command) => command.creatorId === input.surface.ownUserId);
  const foreign = input.surface.commands.filter((command) => command.creatorId !== input.surface.ownUserId);
  const heldTriggers = new Set(input.surface.commands.map((command) => command.trigger));
  return {
    collisions: foreign.filter((command) => desiredByTrigger.has(command.trigger)),
    corrections: owned.flatMap((command) => {
      const registration = desiredByTrigger.get(command.trigger);
      if (!registration || matchesRegistration(command, registration)) {
        return [];
      }
      return [{ commandId: command.id, registration }];
    }),
    creates: input.desired.filter((registration) => !heldTriggers.has(registration.trigger)),
    deletes: owned.filter((command) => !desiredByTrigger.has(command.trigger))
  };
}
