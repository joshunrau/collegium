import cleanStack from 'clean-stack';
import extractStack from 'extract-stack';
import { isErrorLike, serializeError } from 'serialize-error';

function parseStack(stack: string | undefined): string[];
function parseStack(error: Error): string[];
function parseStack(errorOrStack: Error | string | undefined): string[] {
  const stack = typeof errorOrStack === 'string' ? errorOrStack : errorOrStack?.stack;
  return extractStack.lines(cleanStack(stack, { pretty: true }));
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorToJSON(
  error: Error,
  { includeStack = true }: { includeStack?: boolean } = {}
): { [key: string]: unknown } {
  const serialize = (error: Error): { [key: string]: unknown } => {
    const { cause, stack, ...serialized } = serializeError(error);
    const result: { [key: string]: unknown } = {
      ...serialized
    };
    if (isErrorLike(cause)) {
      result.cause = serialize(cause);
    } else if (cause !== undefined) {
      result.cause = cause;
    }
    if (includeStack) {
      result.stack = parseStack(stack);
    }
    return result;
  };
  return serialize(error);
}
