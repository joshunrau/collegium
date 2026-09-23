/** §3.8 — how many of its own earlier actions the prompt carries; twenty declared lines, call it 300 tokens */
export const RECENT_ACTION_LINES = 20;

/** §3.8 — opens the message after the window, so the model does not read its sections as a post */
export const TAIL_OPENING_LINE = "[the framework's notes as this turn starts; not a post]";

/** §3.8 — what the pinned posts may spend of every turn's uncached tail; a few rulings of a couple of thousand characters each */
export const PINNED_POSTS_TOKEN_CAP = 2000;
