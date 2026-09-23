import { describe, expect, it } from 'vitest';

import { FIND_CONTEXT_CHARS, FIND_HITS_PER_PHRASE } from '../../web.constants.ts';
import { findPhrases, renderFoundPhrases } from '../find.utils.ts';

const PROFILE = `# Duval, P.\n\n${'Publication. '.repeat(400)}\n\n#### Contact\nInformation\n\nEmail: p\\_duval@northmoor.example`;

describe('findPhrases (§3.4)', () => {
  it('should find a phrase without regard to case, line breaks or markdown escapes, at its offset', () => {
    const [contact, email] = findPhrases(PROFILE, ['contact information', 'P_DUVAL@']);
    expect(contact).toMatchObject({ count: 1, hits: [{ offset: PROFILE.indexOf('Contact') }], isCut: false });
    expect(email?.hits[0]?.offset).toBe(PROFILE.indexOf('p\\_duval'));
  });

  it('should bound the text around a hit, on one line, and mark only the end it cut', () => {
    const [hit] = findPhrases(PROFILE, ['contact information'])[0]!.hits;
    expect(hit?.snippet).toMatch(/^….+ #### Contact Information Email: p\\_duval@northmoor\.example$/u);
    expect(hit?.snippet.length).toBeLessThanOrEqual(
      FIND_CONTEXT_CHARS + PROFILE.length - PROFILE.indexOf('Contact') + 1
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

describe('renderFoundPhrases', () => {
  it('should say where to read around a hit, and name a phrase that matched nothing', () => {
    const rendered = renderFoundPhrases(findPhrases(PROFILE, ['Email:', 'Fax:']), PROFILE.length);
    expect(rendered).toContain(`in this page's ${PROFILE.length} characters; read around a place with startChar`);
    expect(rendered).toContain(`"Email:" — 1 match\nat ${PROFILE.indexOf('Email:')}: …`);
    expect(rendered).toContain('"Fax:" — no match');
  });

  it('should say so when nothing matched, rather than return an empty list', () => {
    expect(renderFoundPhrases(findPhrases(PROFILE, ['Fax:']), PROFILE.length)).toMatch(
      /^None of these phrases occurs/u
    );
  });
});
