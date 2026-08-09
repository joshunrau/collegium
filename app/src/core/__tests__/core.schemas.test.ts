import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { $$CamelCased, $$JSONEncoded, $LogLevel } from '../core.schemas.ts';

describe('$$CamelCased', () => {
  it('should camel-case object keys before validation', () => {
    const schema = $$CamelCased(z.object({ mainChannelId: z.string() }));
    expect(schema.parse({ main_channel_id: 'channel_1' })).toStrictEqual({ mainChannelId: 'channel_1' });
  });

  it('should pass through a non-object value', () => {
    const schema = $$CamelCased(z.string());
    expect(schema.parse('value')).toBe('value');
  });
});

describe('$$JSONEncoded', () => {
  const schema = $$JSONEncoded(z.object({ enabled: z.boolean() }));

  it('should decode a JSON-encoded value before validation', () => {
    expect(schema.parse('{"enabled":true}')).toStrictEqual({ enabled: true });
  });

  it('should reject malformed JSON with a useful message', () => {
    const result = schema.safeParse('{');
    expect(result.error?.issues).toContainEqual(expect.objectContaining({ message: 'must be a JSON-encoded string' }));
  });

  it('should reject decoded data that fails the target schema', () => {
    expect(schema.safeParse('{"enabled":"yes"}').success).toBe(false);
  });
});

describe('$LogLevel', () => {
  it('should accept a declared log level', () => {
    expect($LogLevel.safeParse('info').success).toBe(true);
  });

  it('should reject an undeclared log level', () => {
    expect($LogLevel.safeParse('verbose').success).toBe(false);
  });
});
