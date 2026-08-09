import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';

import { z } from 'zod';

import { createDeferred } from './utils/deferred.utils.ts';
import { listenOn } from './utils/port.utils.ts';
import { PENDING, waitFor } from './utils/wait.utils.ts';

import type { Deferred } from './utils/deferred.utils.ts';

const INFERENCE_API_KEY = 'e2e-api-key';

const INFERENCE_REQUEST_TIMEOUT_MS = 15_000;

const INFERENCE_HOST = '127.0.0.1';

const INFERENCE_PATH = '/chat/completions';

const $ToolCall = z.object({
  function: z.object({ arguments: z.string(), name: z.string() }),
  id: z.string(),
  type: z.literal('function')
});

type $CompletionMessage = z.infer<typeof $CompletionMessage>;
const $CompletionMessage = z.discriminatedUnion('role', [
  z.object({ content: z.string(), role: z.literal('system') }),
  z.object({ content: z.string(), role: z.literal('user') }),
  z.object({
    content: z.string().nullable().default(null),
    role: z.literal('assistant'),
    tool_calls: z.array($ToolCall).default([])
  }),
  z.object({ content: z.string(), role: z.literal('tool'), tool_call_id: z.string() })
]);

// deliberately loose: the stub should not need revising every time a tool gains a parameter
const $ToolDefinition = z.looseObject({
  function: z.looseObject({ name: z.string().min(1) }),
  type: z.literal('function')
});

type $CompletionRequest = z.infer<typeof $CompletionRequest>;
const $CompletionRequest = z.object({
  messages: z.array($CompletionMessage).min(1),
  model: z.string().min(1),
  stream: z.boolean().optional(),
  tools: z.array($ToolDefinition).default([])
});

type Script = {
  readonly arrival?: Deferred<void>;
  readonly hold?: Deferred<void>;
  readonly matcher: InferenceStub.Matcher;
  remaining: number;
  readonly response: InferenceStub.Response;
};

function describeMatcher(matcher: InferenceStub.Matcher): string {
  const parts = Object.entries(matcher).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  return parts.length === 0 ? 'any request' : parts.join(' ');
}

function describeResponse(response: InferenceStub.Response): string {
  switch (response.kind) {
    case 'failure':
      return `failure(${response.status})`;
    case 'text':
      return `text(${JSON.stringify(response.content)})`;
    case 'tool-calls':
      return `tool-calls(${response.toolCalls.map((call) => call.name).join(', ')})`;
  }
}

function failureResponse(status: number): InferenceStub.Response {
  return { kind: 'failure', status };
}

function respondWithJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function textResponse(content: string): InferenceStub.Response {
  return { content, kind: 'text' };
}

function toCompletionBody(response: Exclude<InferenceStub.Response, { kind: 'failure' }>): unknown {
  if (response.kind === 'text') {
    return { choices: [{ message: { content: response.content, role: 'assistant' } }] };
  }
  return {
    choices: [
      {
        message: {
          content: response.content ?? null,
          role: 'assistant',
          tool_calls: response.toolCalls.map((call) => ({
            function: { arguments: JSON.stringify(call.arguments), name: call.name },
            id: randomUUID(),
            type: 'function'
          }))
        }
      }
    ]
  };
}

function toLatestInput({ messages }: { messages: $CompletionMessage[] }): string {
  return messages.findLast((message) => message.role !== 'system')?.content ?? '';
}

function toSystemPrompt({ messages }: { messages: $CompletionMessage[] }): string {
  return messages.find((message) => message.role === 'system')?.content ?? '';
}

function toToolNames({ tools }: $CompletionRequest): string[] {
  return tools.map((tool) => tool.function.name);
}

function toolCallResponse(name: string, args: { [key: string]: unknown } = {}): InferenceStub.Response {
  return toolCallsResponse([{ arguments: args, name }]);
}

function toolCallsResponse(
  toolCalls: readonly InferenceStub.ToolCallSpec[],
  options: { content?: string } = {}
): InferenceStub.Response {
  return { content: options.content, kind: 'tool-calls', toolCalls };
}

declare namespace InferenceStub {
  type BlockedCompletion = {
    /** resolves once the app has asked for this completion, so the channel is provably busy */
    readonly arrived: Promise<void>;
    readonly release: () => void;
  };
  type FailureOptions = ScriptOptions & {
    status?: number;
  };
  type Matcher = {
    agent?: string;
    contains?: string;
    model?: string;
  };
  type RecordedRequest = {
    agent: string | undefined;
    matched: boolean;
    messages: $CompletionMessage[];
    model: string;
    systemPrompt: string;
    toolNames: string[];
  };
  type Response =
    | { content: string; kind: 'text' }
    | { content?: string; kind: 'tool-calls'; toolCalls: readonly ToolCallSpec[] }
    | { kind: 'failure'; status: number };
  type RosterEntry = {
    systemPrompt: string;
    username: string;
  };
  type ScriptOptions = {
    /** how many requests this script answers before it is discarded; defaults to one */
    times?: number;
  };
  type ToolCallSpec = {
    arguments: { [key: string]: unknown };
    name: string;
  };
}

class InferenceStub {
  readonly apiKey = INFERENCE_API_KEY;

  private readonly activeHolds = new Set<{ description: string; hold: Deferred<void> }>();
  private readonly httpServer: HttpServer;
  private port: number | undefined;
  private readonly recorded: InferenceStub.RecordedRequest[] = [];
  private readonly roster: readonly InferenceStub.RosterEntry[];
  private readonly scripts: Script[] = [];

  constructor(roster: readonly InferenceStub.RosterEntry[]) {
    this.roster = roster;
    this.httpServer = createServer();
    this.httpServer.on('request', (request, response) => {
      void this.handle(request, response);
    });
  }

  get baseUrl(): string {
    if (this.port === undefined) {
      throw new Error('the inference stub has not been started');
    }
    return `http://${INFERENCE_HOST}:${this.port}`;
  }

  /**
   * Resolves once the agent's request at this index has arrived. A test whose turn starts while it
   * is still posting cannot await the reply post, since the channel watermark has moved past it.
   */
  async awaitRequestFor(
    agent: string,
    index: number,
    { timeoutMs = INFERENCE_REQUEST_TIMEOUT_MS }: { timeoutMs?: number } = {}
  ): Promise<InferenceStub.RecordedRequest> {
    return waitFor({
      describeFailure: () => this.diagnostics(),
      description: `completion request ${index + 1} from "${agent}"`,
      probe: () => this.requestsFor(agent)[index] ?? PENDING,
      timeoutMs
    });
  }

  diagnostics(): string {
    const requests = this.recorded.map(
      (request, index) =>
        `  ${index + 1}. agent=${request.agent ?? 'unresolved'} model=${request.model} matched=${request.matched} tools=[${request.toolNames.join(', ')}] input=${JSON.stringify(toLatestInput(request))}`
    );
    const pending = this.scripts.map(
      (script) =>
        `  - ${describeMatcher(script.matcher)} → ${describeResponse(script.response)} (remaining=${script.remaining}${script.hold ? ', held' : ''})`
    );
    const held = [...this.activeHolds].map((active) => `  - ${active.description}`);
    return [
      `inference requests (${this.recorded.length}):`,
      ...(requests.length > 0 ? requests : ['  none']),
      `unconsumed scripts (${this.scripts.length}):`,
      ...(pending.length > 0 ? pending : ['  none']),
      `held completions (${this.activeHolds.size}):`,
      ...(held.length > 0 ? held : ['  none'])
    ].join('\n');
  }

  forgetRequests(): void {
    this.recorded.length = 0;
  }

  requests(): readonly InferenceStub.RecordedRequest[] {
    return this.recorded;
  }

  requestsFor(agent: string): InferenceStub.RecordedRequest[] {
    return this.recorded.filter((request) => request.agent === agent);
  }

  /**
   * Drops every unconsumed script, releases every still-held completion, and names both. Scripts
   * are beforeAll-scoped state: a leftover from one test silently answers the next test's
   * completion, and an unreleased hold keeps its channel lock for up to inferenceTimeoutMs —
   * either reads as a flake rather than the contamination it is, so the harness sweeps between tests.
   */
  resetScripts(): string[] {
    const leftovers = this.scripts.splice(0).map((script) => describeMatcher(script.matcher));
    const held = [...this.activeHolds];
    this.activeHolds.clear();
    for (const active of held) {
      active.hold.resolve();
    }
    return [...leftovers, ...held.map((active) => `${active.description} (held completion, now released)`)];
  }

  async start(): Promise<void> {
    this.port = await listenOn(this.httpServer, { host: INFERENCE_HOST, port: 0 });
  }

  stop(): Promise<void> {
    this.resetScripts();
    return new Promise((resolve, reject) => {
      this.httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }

  /** holds the completion open, keeping the channel busy until the returned release is called */
  willBlock(matcher: InferenceStub.Matcher, response: InferenceStub.Response): InferenceStub.BlockedCompletion {
    const arrival = createDeferred<void>();
    const hold = createDeferred<void>();
    // consumption splices the script out of `scripts`, so an arrived-but-held completion is
    // invisible there — the hold is tracked separately or a failing test strands it for 60s
    const active = { description: describeMatcher(matcher), hold };
    this.activeHolds.add(active);
    this.scripts.push({ arrival, hold, matcher, remaining: 1, response });
    return {
      arrived: arrival.promise,
      release: () => {
        this.activeHolds.delete(active);
        hold.resolve();
      }
    };
  }

  willFail(matcher: InferenceStub.Matcher, { status = 503, times }: InferenceStub.FailureOptions = {}): void {
    this.willReply(matcher, failureResponse(status), { times });
  }

  willReply(
    matcher: InferenceStub.Matcher,
    response: InferenceStub.Response,
    { times = 1 }: InferenceStub.ScriptOptions = {}
  ): void {
    if (times < 1) {
      throw new Error(`a script must answer at least one request, received times=${times}`);
    }
    this.scripts.push({ matcher, remaining: times, response });
  }

  private consumeScript(request: $CompletionRequest, agent: string | undefined): Script | undefined {
    const index = this.scripts.findIndex(({ matcher }) => this.matches(matcher, request, agent));
    const script = this.scripts[index];
    if (!script) {
      return undefined;
    }
    script.remaining -= 1;
    if (script.remaining === 0) {
      this.scripts.splice(index, 1);
    }
    return script;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== INFERENCE_PATH) {
      return respondWithJson(response, 404, { error: 'Not Found' });
    } else if (request.headers.authorization !== `Bearer ${INFERENCE_API_KEY}`) {
      return respondWithJson(response, 401, { error: 'Unauthorized' });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk as Buffer);
    }

    const parsed = $CompletionRequest.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!parsed.success) {
      return respondWithJson(response, 400, { error: 'Malformed Completion Request', issues: parsed.error.issues });
    }

    const completionRequest = parsed.data;
    const agent = this.resolveAgent(completionRequest);
    const script = this.consumeScript(completionRequest, agent);
    this.recorded.push({
      agent,
      matched: script !== undefined,
      messages: completionRequest.messages,
      model: completionRequest.model,
      systemPrompt: toSystemPrompt(completionRequest),
      toolNames: toToolNames(completionRequest)
    });

    if (!script) {
      return respondWithJson(response, 503, {
        error: 'No Script Matched',
        expected: this.scripts.map((pending) => describeMatcher(pending.matcher)),
        received: {
          agent: agent ?? 'unresolved',
          input: toLatestInput(completionRequest),
          model: completionRequest.model
        }
      });
    }

    script.arrival?.resolve();
    await script.hold?.promise;

    if (script.response.kind === 'failure') {
      return respondWithJson(response, script.response.status, { error: 'Scripted Failure' });
    }
    return respondWithJson(response, 200, toCompletionBody(script.response));
  }

  private matches(matcher: InferenceStub.Matcher, request: $CompletionRequest, agent: string | undefined): boolean {
    if (matcher.agent !== undefined && matcher.agent !== agent) {
      return false;
    }
    if (matcher.model !== undefined && matcher.model !== request.model) {
      return false;
    }
    return matcher.contains === undefined || toLatestInput(request).includes(matcher.contains);
  }

  private resolveAgent(request: $CompletionRequest): string | undefined {
    const systemPrompt = toSystemPrompt(request);
    return this.roster.find((entry) => systemPrompt.includes(entry.systemPrompt))?.username;
  }
}

export { failureResponse, InferenceStub, textResponse, toolCallResponse, toolCallsResponse };
