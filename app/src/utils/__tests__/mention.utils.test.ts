import { describe, expect, it } from 'vitest';

import { extractMentionedUsernames, stripMentionsOf } from '../mention.utils.ts';

describe('extractMentionedUsernames', () => {
  it('should extract each mentioned username once, lowercased', () => {
    expect(extractMentionedUsernames('@Mira please ask @tess, @mira')).toStrictEqual(['mira', 'tess']);
  });

  it.each(['@KEVIN', '@kevin.', '> @kevin', '~~@kevin~~', '(@kevin)', 'hey\n@kevin'])(
    'should read "%s" as a mention, as the client highlights it',
    (message) => {
      expect(extractMentionedUsernames(message)).toStrictEqual(['kevin']);
    }
  );

  it.each(['```\n@kevin\n```', '`@kevin`', '    @kevin', 'abc@kevin', '```js\n@kevin', 'see ``a `@kevin` b``'])(
    'should ignore "%s", which Mattermost never highlights',
    (message) => {
      expect(extractMentionedUsernames(message)).toStrictEqual([]);
    }
  );

  it('should keep a mention beside a code block that names another agent', () => {
    expect(extractMentionedUsernames('@kevin look at this:\n```\nnotify("@naomi")\n```')).toStrictEqual(['kevin']);
  });

  it('should treat an indented line continuing a paragraph as prose, not code', () => {
    expect(extractMentionedUsernames('ask\n    @kevin')).toStrictEqual(['kevin']);
  });

  it('should treat an unpaired backtick as literal text', () => {
    expect(extractMentionedUsernames('a ` stray, then @kevin')).toStrictEqual(['kevin']);
  });
});

describe('stripMentionsOf', () => {
  it('should strip only the named users, keeping the rest of the text intact', () => {
    expect(stripMentionsOf('asking @owen about what @casey said', ['owen'])).toBe('asking owen about what @casey said');
  });

  it('should leave a handle inside code alone, since it was never a mention', () => {
    expect(stripMentionsOf('run `notify("@owen")` then tell @owen', ['owen'])).toBe(
      'run `notify("@owen")` then tell owen'
    );
  });

  it('should leave a mid-word handle alone', () => {
    expect(stripMentionsOf('mail abc@owen and @owen', ['owen'])).toBe('mail abc@owen and owen');
  });
});
