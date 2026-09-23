const FENCED_CODE_BLOCK = /```[\s\S]*?```/gu;

const INLINE_CODE_SPAN = /`[^`\n]+`/gu;

/**
 * The markup a provider's call leaves in the text when it never reached the structured field:
 * DeepSeek's DSML tags and native call tokens, the invoke and parameter tags of the XML call
 * format, and the `<tool_call>` and `<function_calls>` wrappers.
 */
const CALL_MARKUP = /｜DSML｜|<｜tool▁|<\/?(?:function_calls|invoke|parameter|tool_call)\b/u;

/** a provider that dropped its structured `tool_calls` field can leave the call as a bare object in the text */
function isBareCallObject(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'arguments' in parsed &&
      'name' in parsed &&
      typeof parsed.name === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * §4.5 — whether text holds a tool call the provider failed to structure. Code is stripped first,
 * so a reply that quotes the syntax is not mistaken for using it; posted, a leaked call runs nothing
 * and reads as an action taken.
 */
export function containsLeakedCall(text: string): boolean {
  const unfenced = text.replace(FENCED_CODE_BLOCK, '').trim();
  return CALL_MARKUP.test(unfenced.replace(INLINE_CODE_SPAN, '')) || isBareCallObject(unfenced);
}
