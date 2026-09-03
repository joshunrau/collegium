import { describe, expect, it } from 'vitest';

import { renderMailAnnouncement, renderMailMessage } from '../mail.utils.ts';

describe('renderMailAnnouncement', () => {
  it('should quote the whole thread, the head under its real headers and each quoted message under its own', () => {
    const body = [
      'Can you confirm you received this?',
      '',
      'From: Sarah Foster <sarah@example.com>',
      'Date: Wednesday, September 2, 2026 at 11:02 AM',
      'To: Jane Doe <jane@example.com>',
      'Subject: Mail test — Sarah',
      '',
      'Hi, quick test.',
      '',
      'Best,',
      'Sarah'
    ].join('\n');
    const rendered = renderMailAnnouncement(
      {
        body,
        receivedAt: new Date('2026-09-02T15:03:00Z'),
        ref: '1:6',
        sender: { address: 'jane@example.com', name: 'Jane Doe' },
        subject: 'Re: Mail test — Sarah'
      },
      'September 2, 2026 at 11:03:00 AM EDT'
    );
    expect(rendered).toBe(
      [
        '> **From:** Jane Doe <jane@example.com>',
        '> **Date:** September 2, 2026 at 11:03:00 AM EDT',
        '> **Subject:** Re: Mail test — Sarah',
        '>',
        '> Can you confirm you received this?',
        '>',
        '> ---',
        '>',
        '> **From:** Sarah Foster <sarah@example.com>',
        '> **Date:** Wednesday, September 2, 2026 at 11:02 AM',
        '> **Subject:** Mail test — Sarah',
        '>',
        '> Hi, quick test.',
        '>',
        '> Best,',
        '> Sarah'
      ].join('\n')
    );
  });
});

describe('renderMailMessage', () => {
  it('should show everything a quoted header block carried, To and Cc included', () => {
    const rendered = renderMailMessage({
      attachments: [],
      body: 'fyi\n\nFrom: Sam Rivera <sam@example.com>\nSent: Monday\nTo: ops@example.com\nSubject: Numbers\n\nthe numbers',
      cc: [],
      isRead: true,
      receivedAt: new Date('2026-09-02T15:03:00Z'),
      ref: '1:7',
      replyTo: [],
      sender: { address: 'jane@example.com' },
      subject: 'Fwd: Numbers',
      to: []
    });
    expect(rendered).toContain(
      '**From:** Sam Rivera <sam@example.com>\n**Date:** Monday\n**To:** ops@example.com\n**Subject:** Numbers\n\nthe numbers'
    );
  });

  it('should keep the headers and split the body into its quoted segments', () => {
    const rendered = renderMailMessage({
      attachments: [],
      body: 'New words\n\n> On Sep 2, 2026, at 5:00 PM, sam@example.com wrote:\n> \n> Old words',
      cc: [],
      isRead: true,
      receivedAt: new Date('2026-09-02T15:03:00Z'),
      ref: '1:6',
      replyTo: [],
      sender: { address: 'jane@example.com' },
      subject: 'Re: Hello',
      to: []
    });
    expect(rendered).toBe(
      '⟨1:6⟩\nFrom: jane@example.com\nSubject: Re: Hello\nReceived: 2026-09-02T15:03:00.000Z\n\nNew words\n\n---\n\n**From:** sam@example.com\n**Date:** Sep 2, 2026, at 5:00 PM\n\nOld words'
    );
  });
});
