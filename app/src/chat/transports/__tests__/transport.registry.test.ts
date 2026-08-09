import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { ChatTransport } from '../../chat.transport.ts';
import { TransportRegistry } from '../transport.registry.ts';

describe('TransportRegistry', () => {
  let registry: TransportRegistry;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [TransportRegistry] }).compile();
    registry = module.get(TransportRegistry);
  });

  it('should return the transport registered for an agent', () => {
    const transport = MockFactory.createMock(ChatTransport) as unknown as ChatTransport;
    registry.register('mira', transport);
    expect(registry.get('mira')).toBe(transport);
  });

  it('should throw when no transport is registered for an agent', () => {
    expect(() => registry.get('tess')).toThrow('no transport is registered for agent "tess"');
  });
});
