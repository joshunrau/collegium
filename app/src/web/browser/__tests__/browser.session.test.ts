import { Result } from '@collegium/core/utils';
import type { BrowserContext, Page } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';

import { captureSnapshot } from '../../snapshot/snapshot.script.ts';
import { BrowserSession } from '../browser.session.ts';

import type { AddressPolicy } from '../../web.types.ts';

const POLICY: Pick<AddressPolicy, 'refuse' | 'resolve'> = {
  refuse: () => undefined,
  resolve: () => Promise.resolve(Result.ok({ address: '203.0.113.7', family: 4 }))
};

/** a page that loads and settles at once, and answers the snapshot script with whatever it is given */
const createPage = (snapshot: unknown): Page => {
  return {
    evaluate: (script: unknown) => Promise.resolve(script === captureSnapshot ? snapshot : undefined),
    goto: () => Promise.resolve({ headerValue: () => Promise.resolve('text/html') }),
    on: vi.fn(),
    title: () => Promise.resolve('Faculty'),
    url: () => 'https://northmoor.example/faculty',
    waitForLoadState: () => Promise.resolve()
  } as unknown as Page;
};

const CONTEXT = { on: vi.fn() } as unknown as BrowserContext;

describe('BrowserSession', () => {
  it('should read a snapshot that holds the shape the script promises', async () => {
    const session = new BrowserSession(
      CONTEXT,
      createPage({ formElements: [], html: '<h1>Faculty</h1>', nextRefIndex: 3 }),
      POLICY
    );
    expect((await session.navigate('https://northmoor.example/faculty')).value?.html).toBe('<h1>Faculty</h1>');
  });

  it('should refuse a snapshot that does not, rather than trust it', async () => {
    const session = new BrowserSession(CONTEXT, createPage({ formElements: 'none', html: 42 }), POLICY);
    expect((await session.navigate('https://northmoor.example/faculty')).error).toStrictEqual({
      kind: 'navigation',
      message: 'the browser answered a read of the page with something malformed'
    });
  });
});
