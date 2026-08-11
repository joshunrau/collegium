import * as fs from 'node:fs';
import * as path from 'node:path';

import type { PartialDeep } from 'type-fest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ToolName } from '@/tools/tools.types.ts';

import { toConfigJsonSchema } from '../../../scripts/schema.utils.ts';
import { $AgentDefinition, $Config, $MailboxDefinition } from '../config.schemas.ts';

import type { Config } from '../config.schemas.ts';

const definition = (tools: $AgentDefinition['tools']): $AgentDefinition => ({
  botToken: 'token_1',
  expertise: 'programming',
  model: {
    name: 'deepseek-v4-flash',
    provider: 'deepseek'
  },
  skills: [],
  systemPrompt: 'You are Mira Turner',
  tools,
  username: 'mira'
});

const config: PartialDeep<Config> = {
  agents: [definition([])],
  mattermost: { mainChannel: 'main', systemBotToken: 'token_2' },
  models: { deepseek: { apiKey: 'key_1' } }
};

const exchangeMailbox = (address: string, clientId: string): z.input<typeof $MailboxDefinition> => ({
  announcementChannel: 'channel-2',
  provider: {
    address,
    clientId,
    clientSecret: 'secret_1',
    kind: 'exchange',
    tenantId: 'tenant_1'
  }
});

const withMailboxes = (...mailboxes: z.input<typeof $MailboxDefinition>[]): PartialDeep<Config> => ({
  ...config,
  agents: mailboxes.map((mailbox, index) => ({
    ...definition(['mail']),
    mailbox: $MailboxDefinition.parse(mailbox),
    username: `mira${index}`
  }))
});

describe('$AgentDefinition', () => {
  it('should reject a tool name that no tool declares', () => {
    expect($AgentDefinition.safeParse(definition(['no_such_tool' as ToolName])).success).toBe(false);
  });
  it('should accept a declared tool name', () => {
    expect($AgentDefinition.safeParse(definition(['load_skill'])).success).toBe(true);
  });
  it('should accept a qualified plugin tool grant', () => {
    expect($AgentDefinition.safeParse(definition(['bookmark__save'])).success).toBe(true);
  });

  it('should reject a tool grant outside the qualified grammar', () => {
    expect($AgentDefinition.safeParse(definition(['Bookmark__save'])).success).toBe(false);
  });

  it('should default tools to an empty list', () => {
    expect($AgentDefinition.parse({ ...definition([]), tools: undefined }).tools).toStrictEqual([]);
  });
});

describe('$Config', () => {
  it('should apply config defaults', () => {
    expect($Config.parse(config)).toMatchObject({
      app: {
        enableLifecycleNotifications: true,
        inferenceRetry: { backoffMs: 250, maxAttempts: 3 },
        inferenceTimeoutMs: 120_000,
        logLevel: 'info'
      },
      models: { deepseek: { baseUrl: 'https://api.deepseek.com' } }
    });
  });
  it('should accept an OpenRouter model and provider', () => {
    expect(
      $Config.safeParse({
        ...config,
        agents: [
          {
            ...definition([]),
            model: { name: 'anthropic/claude-sonnet-5', provider: 'openrouter' }
          }
        ],
        models: { openrouter: { apiKey: 'key_1' } }
      }).success
    ).toBe(true);
  });
  it('should reject duplicate agent usernames', () => {
    expect($Config.safeParse({ ...config, agents: [definition([]), definition([])] }).success).toBe(false);
  });
  it('should reject a config without a model provider', () => {
    expect($Config.safeParse({ ...config, models: {} }).success).toBe(false);
  });
  it('should accept an agent with an Exchange mailbox', () => {
    expect($Config.safeParse(withMailboxes(exchangeMailbox('tess@example.org', 'client_1'))).success).toBe(true);
  });
  it('should accept an IMAP/SMTP mailbox', () => {
    const mailbox: z.input<typeof $MailboxDefinition> = {
      announcementChannel: 'channel-2',
      provider: {
        address: 'tess@example.org',
        imap: { host: 'imap.example.org', port: 993, secure: true },
        kind: 'imap',
        password: 'password_1',
        smtp: { host: 'smtp.example.org', port: 587, secure: false },
        username: 'tess'
      }
    };
    expect($Config.safeParse(withMailboxes(mailbox)).success).toBe(true);
  });
  it('should reject two agents sharing a mailbox address', () => {
    const mailboxes = [
      exchangeMailbox('tess@example.org', 'client_1'),
      exchangeMailbox('tess@example.org', 'client_2')
    ];
    expect($Config.safeParse(withMailboxes(...mailboxes)).success).toBe(false);
  });
  it('should reject the mail tool without a mailbox, and a mailbox without the mail tool', () => {
    expect($Config.safeParse({ ...config, agents: [definition(['mail'])] }).success).toBe(false);
    const withoutTool = {
      ...config,
      agents: [
        { ...definition([]), mailbox: $MailboxDefinition.parse(exchangeMailbox('tess@example.org', 'client_1')) }
      ]
    };
    expect($Config.safeParse(withoutTool).success).toBe(false);
  });

  it('should reject two agents sharing an Exchange client id', () => {
    const mailboxes = [
      exchangeMailbox('tess@example.org', 'client_1'),
      exchangeMailbox('amir@example.org', 'client_1')
    ];
    expect($Config.safeParse(withMailboxes(...mailboxes)).success).toBe(false);
  });
});

describe('$MailboxDefinition', () => {
  it('should default the poll interval', () => {
    expect($MailboxDefinition.parse(exchangeMailbox('tess@example.org', 'client_1')).pollIntervalMs).toBe(60_000);
  });
  it('should reject a partial mailbox, naming the missing field', () => {
    const mailbox = exchangeMailbox('tess@example.org', 'client_1');
    const result = $MailboxDefinition.safeParse({
      ...mailbox,
      provider: { ...mailbox.provider, clientSecret: undefined }
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('clientSecret');
  });
});

describe('config.schema.json', () => {
  it('should match the schema generated from $Config (run `pnpm build:schema` if stale)', () => {
    const checkedInPath = path.resolve(import.meta.dirname, '../../../config.schema.json');
    const checkedIn: unknown = JSON.parse(fs.readFileSync(checkedInPath, 'utf-8'));
    expect(checkedIn).toStrictEqual(toConfigJsonSchema($Config));
  });
});
