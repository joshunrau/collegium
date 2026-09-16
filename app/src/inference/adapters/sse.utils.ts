const DATA_FIELD = 'data:';

/**
 * The `data` payloads of a text/event-stream body, one string per event with its data lines
 * joined as the specification says; comment lines (OpenRouter's keep-alive) and every other field
 * are dropped. `onBytes` fires for each chunk the socket delivers, keep-alives included, which is
 * what an idle timeout has to count.
 */
export async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  onBytes: () => void
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let dataLines: string[] = [];
  const takeEvent = (): string | undefined => {
    if (dataLines.length === 0) {
      return undefined;
    }
    const data = dataLines.join('\n');
    dataLines = [];
    return data;
  };
  const takeLine = (line: string): string | undefined => {
    if (line === '') {
      return takeEvent();
    }
    if (line.startsWith(DATA_FIELD)) {
      dataLines.push(line.slice(DATA_FIELD.length).replace(/^ /, ''));
    }
    return undefined;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      onBytes();
      buffered += decoder.decode(value, { stream: true });
      for (let newline = buffered.indexOf('\n'); newline !== -1; newline = buffered.indexOf('\n')) {
        const line = buffered.slice(0, newline).replace(/\r$/, '');
        buffered = buffered.slice(newline + 1);
        const event = takeLine(line);
        if (event !== undefined) {
          yield event;
        }
      }
    }
    buffered += decoder.decode();
    takeLine(buffered);
    const last = takeEvent();
    if (last !== undefined) {
      yield last;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}
