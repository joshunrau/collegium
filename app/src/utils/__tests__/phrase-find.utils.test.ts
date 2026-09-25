import { describe, expect, it } from 'vitest';

import { FIND_CONTEXT_CHARS, FIND_HITS_PER_PHRASE, findPhrases, renderPhraseFind } from '../phrase-find.utils.ts';

const PROFILE = `# Duval, P.\n\n${'Publication. '.repeat(400)}\n\n#### Contact\nInformation\n\nEmail: p\\_duval@northmoor.example`;

describe('findPhrases (§3.4)', () => {
  it('should find a phrase without regard to case, line breaks or markdown escapes, at its offset', () => {
    const [contact, email] = findPhrases(PROFILE, ['contact information', 'P_DUVAL@']);
    expect(contact).toMatchObject({ count: 1, hits: [{ offset: PROFILE.indexOf('Contact') }], isCut: false });
    expect(email?.hits[0]?.offset).toBe(PROFILE.indexOf('p\\_duval'));
  });

  it('should bound the text around a hit, on one line, labelled with its range and marking only the end it cut', () => {
    const [, stretch] = renderPhraseFind(PROFILE, findPhrases(PROFILE, ['contact information'])).split('\n\n');
    const from = PROFILE.indexOf('Contact') - FIND_CONTEXT_CHARS;
    expect(stretch).toMatch(
      new RegExp(
        `^\\[${from}–${PROFILE.length}\\] ….+ #### Contact Information Email: p\\\\_duval@northmoor\\.example$`,
        'u'
      )
    );
  });

  it('should show a stretch holding two phrases once (§3.4)', () => {
    const rendered = renderPhraseFind(PROFILE, findPhrases(PROFILE, ['contact information', 'email:']));
    expect(rendered.match(/#### Contact Information/gu)).toHaveLength(1);
    expect(rendered.split('\n\n')[0]).toBe(
      `"contact information" — 1 match at ${PROFILE.indexOf('Contact')}\n"email:" — 1 match at ${PROFILE.indexOf('Email:')}`
    );
  });

  it('should count every occurrence, show a bounded few, and not repeat one its neighbour already shows', () => {
    const [publication] = findPhrases(PROFILE, ['publication']);
    expect(publication?.count).toBe(400);
    expect(publication?.hits).toHaveLength(FIND_HITS_PER_PHRASE);
    expect(publication?.isCut).toBe(true);
    const [first, second] = publication!.hits;
    expect(second!.offset - first!.offset).toBeGreaterThan(FIND_CONTEXT_CHARS);
  });
});
