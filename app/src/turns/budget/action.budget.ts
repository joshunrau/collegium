import type { ToolName } from '@/tools/tools.types.ts';

const ATTEMPT_LIMIT = 10;

/** §5.3 — not counted: transport retries, load_skill, memory body loads, and framework posting */
const EXEMPT_TOOL_NAMES: ReadonlySet<string> = new Set(['load_skill', 'read_memory'] satisfies ToolName[]);

/** ten action attempts per turn, extendable by ten per approval, unbounded in number (§5.3) */
export class ActionBudget {
  private readonly base: number;
  private extensions = 0;
  private extensionsRefused = false;
  private limit: number;
  private spent = 0;

  constructor(limit = ATTEMPT_LIMIT) {
    this.base = limit;
    this.limit = limit;
  }

  /**
   * §5.3 — whether an exhausted turn may still ask to continue. A reasoned denial closes this for
   * good: asking again would let one denial buy an unbounded loop, since every refusal could be
   * answered with another prompt.
   */
  get acceptsExtension(): boolean {
    return !this.extensionsRefused;
  }

  get extensionCount(): number {
    return this.extensions;
  }

  get limitCount(): number {
    return this.limit;
  }

  get spentCount(): number {
    return this.spent;
  }

  /** approving grants a further batch of attempts; accumulated context is untouched (§5.3) */
  extend(): void {
    this.extensions += 1;
    this.limit += this.base;
  }

  /** §5.3 — steering buys words, never budget: the turn keeps its voice and loses its actions */
  refuseFurtherExtensions(): void {
    this.extensionsRefused = true;
  }

  /** an attempt is one model-emitted invocation, including one denied before execution (§5.3) */
  trySpend(toolName: string): 'exempt' | 'exhausted' | 'spent' {
    if (EXEMPT_TOOL_NAMES.has(toolName)) {
      return 'exempt';
    }
    return this.trySpendOnRejectedPost();
  }

  /** a §4.5-rejected post also spends an attempt, so its retry loop stays inside the budget */
  trySpendOnRejectedPost(): 'exhausted' | 'spent' {
    if (this.spent >= this.limit) {
      return 'exhausted';
    }
    this.spent += 1;
    return 'spent';
  }
}
