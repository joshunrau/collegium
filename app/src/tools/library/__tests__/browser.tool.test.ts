import type { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { WebService } from '@/web/web.service.ts';
import type { WebSnapshot } from '@/web/web.types.ts';

import { BrowserTool } from '../browser.tool.ts';

const turn = { agentUsername: 'mira', turnId: 'turn-1' } as Tool.TurnScope;

const snapshot = (over?: Partial<WebSnapshot>): WebSnapshot => ({
  formElements: [],
  markdown: '# Faculty',
  status: 200,
  title: 'Faculty',
  url: 'https://northmoor.example/people/',
  ...over
});

describe('BrowserTool', () => {
  let webService: MockedInstance<WebService>;
  let tool: BrowserTool;

  beforeEach(async () => {
    webService = MockFactory.createMock(WebService);
    const moduleRef = await Test.createTestingModule({
      providers: [BrowserTool, { provide: WebService, useValue: webService }]
    }).compile();
    tool = moduleRef.get(BrowserTool);
  });

  it('should browse under the turn session, never one named by the model', async () => {
    webService.navigate.mockResolvedValue(Result.ok(snapshot()));
    const result = await tool.execute({ action: 'navigate', url: 'https://northmoor.example/people/' }, turn);
    expect(webService.navigate).toHaveBeenCalledWith('turn-1', 'https://northmoor.example/people/');
    expect(result.success && result.value.text).toContain('Faculty — https://northmoor.example/people/ (HTTP 200)');
    expect(result.success && result.value.text).toContain('# Faculty');
  });

  it('should pass the ref and text the model chose through to the session', async () => {
    webService.fill.mockResolvedValue(Result.ok(snapshot()));
    await tool.execute({ action: 'fill', pressEnter: true, ref: 'e4', text: 'duval' }, turn);
    expect(webService.fill).toHaveBeenCalledWith('turn-1', { pressEnter: true, ref: 'e4', text: 'duval' });
  });

  it('should render each form control beneath the page, beside its ref', async () => {
    webService.navigate.mockResolvedValue(
      Result.ok(
        snapshot({
          formElements: [{ kind: 'input', label: 'Search people', ref: 'e4', type: 'search', value: 'duval' }]
        })
      )
    );
    const result = await tool.execute({ action: 'navigate', url: 'https://northmoor.example/' }, turn);
    expect(result.success && result.value.text).toContain('- ⟨e4⟩ input[type=search] "Search people" = "duval"');
  });

  it('should hand a recoverable failure back as text the model can act on', async () => {
    webService.click.mockResolvedValue(Result.err({ kind: 'stale-ref', ref: 'e9' }));
    const result = await tool.execute({ action: 'click', ref: 'e9' }, turn);
    expect(result.success && result.value.text).toContain('⟨e9⟩ is not on the current page');
  });

  it('should terminate the turn as an exception when the browser is unreachable', async () => {
    webService.navigate.mockResolvedValue(Result.err({ kind: 'unreachable', message: 'launch failed' }));
    const result = await tool.execute({ action: 'navigate', url: 'https://northmoor.example/' }, turn);
    expect(result.error).toMatchObject({ kind: 'exception' });
  });

  it('should trace each action with the target it acted on', () => {
    expect(tool.renderTraceDetail({ action: 'navigate', url: 'https://northmoor.example/people/' })).toBe(
      'navigate https://northmoor.example/people/'
    );
    expect(tool.renderTraceDetail({ action: 'click', ref: 'e4' })).toBe('click ⟨e4⟩');
    expect(tool.renderTraceDetail({ action: 'fill', pressEnter: true, ref: 'e4', text: 'duval' })).toBe(
      'fill ⟨e4⟩ with "duval" then press "Enter"'
    );
  });

  it('should run ungated and reject a malformed ref at the schema, before execution', () => {
    expect(tool.variant).toBe('ungated');
    expect(tool.getApprovalRequirements()).toStrictEqual({ kind: 'ungated' });
    expect(tool.parameters.safeParse({ action: 'click', ref: 'people-link' }).success).toBe(false);
  });
});
