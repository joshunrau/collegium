import { describe, expect, it } from 'vitest';

import { toMarkdown } from '@/web/web.utils.ts';

import { splitMailThread } from '../thread.splitter.ts';
import {
  APPLE_FORWARD_HTML,
  APPLE_REPLY_HTML_HTML,
  APPLE_REPLY_PLAIN_TEXT,
  GMAIL_FORWARD_HTML,
  GMAIL_REPLY_DEEP_HTML,
  GMAIL_REPLY_HTML,
  OUTLOOK_MAC_REPLY_SARAH_HTML,
  OUTLOOK_MAC_REPLY_TO_REPLY_HTML,
  ZOHO_REPLY_WRAPPING_OWA_FORWARD_HTML,
  ZOHO_REPLY_WRAPPING_OWA_REPLY_HTML
} from './thread.fixtures.ts';

const splitHtml = (html: string) => splitMailThread(toMarkdown(html));

describe('splitMailThread', () => {
  it('should split an Apple Mail plain-text reply at its attribution line', () => {
    expect(splitMailThread(APPLE_REPLY_PLAIN_TEXT)).toStrictEqual({
      headBody: 'This is a test reply',
      quoted: [
        {
          body: 'This was sent from Apple mail',
          envelope: { date: 'Sep 2, 2026, at 5:00 PM', from: 'apple@example.com' }
        }
      ]
    });
  });

  it('should split an Apple Mail HTML reply at its cite blockquote', () => {
    expect(splitHtml(APPLE_REPLY_HTML_HTML)).toStrictEqual({
      headBody: 'This is a test reply',
      quoted: [
        {
          body: 'This was sent from outlook',
          envelope: { date: 'Sep 2, 2026, at 4:59 PM', from: 'Jane Doe <outlook@example.com>' }
        }
      ]
    });
  });

  it('should split a Gmail reply, including the escaped quoting of the plain-text reply it quotes', () => {
    expect(splitHtml(GMAIL_REPLY_HTML)).toStrictEqual({
      headBody: 'here is a reply back',
      quoted: [
        { body: 'This is a test reply', envelope: { date: 'Wed, Sep 2, 2026 at 5:04 PM', from: 'apple@example.com' } },
        {
          body: 'This was sent from gmail',
          envelope: { date: 'Sep 2, 2026, at 4:59 PM', from: 'Jane Doe <gmail@example.com>' }
        }
      ]
    });
  });

  it('should read a Gmail forward banner and its header block as one boundary', () => {
    const thread = splitHtml(GMAIL_FORWARD_HTML);
    expect(thread.headBody).toBe('here is the whole chain forwarded');
    expect(thread.quoted[0]).toStrictEqual({
      body: 'here is a reply back',
      envelope: {
        date: 'Wed, Sep 2, 2026 at 5:05 PM',
        from: 'Jane Doe <gmail@example.com>',
        subject: 'Re: Gmail Test',
        to: 'apple@example.com'
      }
    });
    expect(thread.quoted.map((segment) => segment.body)).toStrictEqual([
      'here is a reply back',
      'This is a test reply',
      'This was sent from gmail'
    ]);
  });

  it('should flatten an Outlook for Mac chain of header blocks, with the subject on each', () => {
    const thread = splitHtml(OUTLOOK_MAC_REPLY_TO_REPLY_HTML);
    expect(thread.headBody).toBe('And a reply to a reply');
    expect(thread.quoted).toStrictEqual([
      {
        body: 'Here is a reply back',
        envelope: {
          date: 'Wednesday, September 2, 2026 at 5:05 PM',
          from: 'Jane Doe <outlook@example.com>',
          subject: 'Re: Outlook Test',
          to: 'apple@example.com <apple@example.com>'
        }
      },
      {
        body: 'This is a test reply',
        envelope: {
          date: 'Wednesday, September 2, 2026 at 5:04 PM',
          from: 'apple@example.com <apple@example.com>',
          subject: 'Re: Outlook Test',
          to: 'Jane Doe <outlook@example.com>'
        }
      },
      {
        body: 'This was sent from outlook',
        envelope: { date: 'Sep 2, 2026, at 4:59 PM', from: 'Jane Doe <outlook@example.com>' }
      }
    ]);
  });

  it('should show the subject changing down an Outlook chain', () => {
    const thread = splitHtml(OUTLOOK_MAC_REPLY_SARAH_HTML);
    expect(thread.quoted.map((segment) => segment.envelope.subject)).toStrictEqual([
      'Re: Mail test — Sarah',
      'Mail test — Sarah'
    ]);
    expect(thread.quoted[1]?.body).toBe(
      "Hi Jane,\n\nThis is a quick test to confirm that my mail is working. If you're receiving this, everything is functioning as expected.\n\nBest,\nSarah Foster"
    );
  });

  it('should read an Apple Mail forward whose header block is spaced out by blank lines', () => {
    const thread = splitHtml(APPLE_FORWARD_HTML);
    expect(thread.headBody).toBe('See this');
    expect(thread.quoted[0]).toStrictEqual({
      body: 'here is the whole chain forwarded',
      envelope: {
        date: 'September 2, 2026 at 5:05:57 PM EDT',
        from: 'Jane Doe <gmail@example.com>',
        subject: 'Fwd: Gmail Test',
        to: 'apple@example.com'
      }
    });
    expect(thread.quoted).toHaveLength(4);
  });

  it('should split a Zoho reply and the Outlook web reply it wraps', () => {
    const thread = splitHtml(ZOHO_REPLY_WRAPPING_OWA_REPLY_HTML);
    expect(thread.headBody).toBe('Respond\n\nSent using [Zoho Mail]({0})');
    expect(thread.quoted).toStrictEqual([
      {
        body: 'Hello from outlook',
        envelope: {
          date: 'Wed, 02 Sep 2026 17:25:13 -0400',
          from: 'Jane Doe <outlook@example.com>',
          subject: 'Re: Test',
          to: '"Jane Doe"<zoho@example.com>'
        }
      },
      {
        body: '**Hello World**\n\n_This is html_',
        envelope: {
          date: 'September 2, 2026 5:22 PM',
          from: 'Jane Doe <zoho@example.com>',
          subject: 'Test',
          to: 'Jane Doe <outlook@example.com>'
        }
      }
    ]);
  });

  it('should flatten a chain that crossed Zoho, Outlook web, Apple Mail and Gmail', () => {
    const thread = splitHtml(ZOHO_REPLY_WRAPPING_OWA_FORWARD_HTML);
    expect(thread.quoted.map((segment) => segment.envelope.subject)).toStrictEqual([
      'Fw: Gmail Test',
      'Fwd: Gmail Test',
      'Fwd: Gmail Test',
      'Re: Gmail Test',
      undefined,
      undefined
    ]);
    expect(thread.quoted.at(-1)?.body).toBe('This was sent from gmail');
  });

  it('should keep every message of a deep Gmail chain', () => {
    expect(splitHtml(GMAIL_REPLY_DEEP_HTML).quoted.map((segment) => segment.body)).toStrictEqual([
      'here is the whole chain forwarded',
      'here is a reply back',
      'This is a test reply',
      'This was sent from gmail'
    ]);
  });

  it('should join an attribution line that wrapped before "wrote:"', () => {
    const thread = splitMailThread(
      'reply\n\nOn Sep 2, 2026, at 4:59 PM, Jane Doe <gmail@example.com>\nwrote:\n\n> quoted words'
    );
    expect(thread.quoted).toStrictEqual([
      { body: 'quoted words', envelope: { date: 'Sep 2, 2026, at 4:59 PM', from: 'Jane Doe <gmail@example.com>' } }
    ]);
  });

  it('should keep the To and Cc a header block quoted', () => {
    const thread = splitMailThread(
      'fyi\n\nFrom: Jane Doe <jane@example.com>\nTo: Sam Rivera <sam@example.com>\nCc: ops@example.com\nSubject: Numbers\n\nthe numbers'
    );
    expect(thread.quoted[0]?.envelope).toStrictEqual({
      cc: 'ops@example.com',
      from: 'Jane Doe <jane@example.com>',
      subject: 'Numbers',
      to: 'Sam Rivera <sam@example.com>'
    });
  });

  it('should keep a deeper quote no boundary claimed visibly quoted inside its segment', () => {
    const thread = splitMailThread(
      'reply\n\nOn Sep 2, 2026, at 4:59 PM, Jane Doe <jane@example.com> wrote:\n\n> her words\n>\n> > Von: Hans\n> > seine Worte'
    );
    expect(thread.quoted).toStrictEqual([
      {
        body: 'her words\n\n> Von: Hans\n> seine Worte',
        envelope: { date: 'Sep 2, 2026, at 4:59 PM', from: 'Jane Doe <jane@example.com>' }
      }
    ]);
  });

  it('should leave quoting no boundary claimed in the head, still quoted', () => {
    const body = 'Hello\n\n> some words nobody attributed\n> still quoted';
    expect(splitMailThread(body)).toStrictEqual({ headBody: body, quoted: [] });
  });

  it('should treat a rule with no header block behind it as body text', () => {
    const body = 'Intro\n\n---\n\nStill mine';
    expect(splitMailThread(body)).toStrictEqual({ headBody: body, quoted: [] });
  });

  it('should not split on a rule inside a quoted newsletter', () => {
    const html =
      'Test<br><blockquote type="cite"><div>On Aug 26, 2026, at 11:00 PM, Newsletter Sender <newsletter@example.com> wrote:</div><br><div>Hello</div><hr><div>Footer</div></blockquote>';
    const thread = splitHtml(html);
    expect(thread.quoted).toHaveLength(1);
    expect(thread.quoted[0]?.body).toContain('Footer');
  });

  it('should not split on a sentence that merely starts with "On" and ends with "wrote:"', () => {
    const body = 'On reflection this is what we wrote:\n\nthe words';
    expect(splitMailThread(body)).toStrictEqual({ headBody: body, quoted: [] });
  });
});
