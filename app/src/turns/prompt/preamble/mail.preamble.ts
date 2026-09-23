import type { StablePromptInput } from '../prompt.types.ts';

export function renderMailPreamble({ mailbox, textFormatter }: StablePromptInput): string | undefined {
  if (mailbox === undefined) {
    return undefined;
  }
  return textFormatter.formatParagraphs(
    [
      'Your mailbox is {mailAddress}, and mail arriving there is announced in {mailAnnouncementChannel} and nowhere else. A mail ref names one message inside that mailbox: it is not an address, and nobody outside this framework can resolve it. Mail you send from that address arrives back as a new item when it is addressed to that mailbox.'
    ],
    {
      mailAddress: mailbox.address,
      mailAnnouncementChannel: mailbox.announcementChannelName ?? 'its announcement channel'
    }
  );
}
