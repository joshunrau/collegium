import { describe, expect, it } from 'vitest';

import { $MailTemplate } from '../compose.schemas.ts';
import { composeOutboundMail } from '../compose.utils.ts';

const ARGS = { body: 'Hi **Dana**,\n\nNumbers are <b>5%</b> off.', cc: [], subject: 'Q3', to: ['dana@example.org'] };

const TEMPLATE = $MailTemplate.parse('<body>{BODY}<p>Sarah Foster</p></body>');

describe('composeOutboundMail', () => {
  it('sends the body as plain text without a template', () => {
    expect(composeOutboundMail(ARGS, undefined)).toStrictEqual(ARGS);
  });

  it('renders the markdown body into the template, escaping raw HTML', () => {
    const mail = composeOutboundMail(ARGS, TEMPLATE);
    expect(mail.html).toBe(
      '<body><p>Hi <strong>Dana</strong>,</p>\n<p>Numbers are &lt;b&gt;5%&lt;/b&gt; off.</p><p>Sarah Foster</p></body>'
    );
  });

  it('carries the signature into the plain-text part', () => {
    expect(composeOutboundMail(ARGS, TEMPLATE).body).toContain('Sarah Foster');
  });

  it('refuses a template without exactly one body placeholder', () => {
    expect($MailTemplate.safeParse('<body></body>').success).toBe(false);
    expect($MailTemplate.safeParse('{BODY}{BODY}').success).toBe(false);
  });
});
