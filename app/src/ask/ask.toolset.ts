import { ASK_TOOLSET_DEF, implementToolset } from '@collegium/core/toolsets';
import { z } from 'zod';

/** §3.7a — the options a question may offer as buttons; beyond this the prompt stops being a question */
const MAX_OFFERED_OPTIONS = 6;

/**
 * §3.7a — the one framework tool that declares `ask`. It has no body: the executor resolves an
 * `ask`-declared call from the human's answer alone, so reaching `execute` means the gate was
 * bypassed, and saying so loudly beats returning something plausible.
 */
export const ASK_TOOLSET = implementToolset(ASK_TOOLSET_DEF, {
  tools: {
    human: {
      ask: (args) => ({ ...(args.options && { options: args.options }), question: args.question }),
      description:
        'Ask a person in this channel a question and wait for their answer. Use it for a fact or a preference only they have. It is not how you get permission to act: a tool that needs permission asks for it by itself when you call it. You may offer two to six short answers as buttons, and the person may type something else instead. The answer comes back as this call’s result and the turn continues under the same budget.',
      execute: () => {
        throw new Error('ask::human has no body: an ask-declared tool is resolved from its answer');
      },
      parameters: z.object({
        options: z
          .array(z.string().min(1).max(200))
          .min(2)
          .max(MAX_OFFERED_OPTIONS)
          .optional()
          .describe(
            'Two to six short answers to offer as buttons; more than six is rejected. Omit this field entirely for a free-text question. The person may still type something else. Where more answers are possible than you offer, say so in the question.'
          ),
        question: z.string().min(1).max(2000)
      }),
      traceDetail: (args) => args.question
    }
  }
});
