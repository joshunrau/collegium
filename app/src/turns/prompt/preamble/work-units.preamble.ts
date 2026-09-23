import type { StablePromptInput } from '../prompt.types.ts';

export function renderWorkUnitsPreamble({ granted }: StablePromptInput): string | undefined {
  if (!granted.some(({ id: [namespace] }) => namespace === 'tasks')) {
    return undefined;
  }
  return 'Work units you created or were assigned in this channel and have not closed are listed under Open work with their references, oldest first, and that section says so when none is open. A unit closed by anybody drops off that list at once. tasks__read reads one by its reference, open or closed, with the post of its latest report or close, and a report it shows counts as read when you close the unit. Nothing lists a closed unit; its reference is in the post that assigned, reported or closed it.';
}
