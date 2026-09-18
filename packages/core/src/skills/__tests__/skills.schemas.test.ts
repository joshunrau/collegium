import { describe, expect, it } from 'vitest';

import { $SkillFrontmatter } from '../skills.schemas.ts';

const frontmatter = (tools?: unknown) => ({
  description: 'How to work an inbox down to zero.',
  title: 'Daily triage',
  ...(tools === undefined ? {} : { tools })
});

describe('$SkillFrontmatter', () => {
  it('should declare no tools when the key is absent (§3.5)', () => {
    expect($SkillFrontmatter.parse(frontmatter()).tools).toStrictEqual([]);
  });

  it('should accept a namespace and a "ns::tool" ref', () => {
    expect($SkillFrontmatter.parse(frontmatter(['mail', 'conversations::search'])).tools).toStrictEqual([
      'mail',
      'conversations::search'
    ]);
  });

  it('should reject a ref outside the tool-ref grammar', () => {
    expect($SkillFrontmatter.safeParse(frontmatter(['Mail'])).success).toBe(false);
    expect($SkillFrontmatter.safeParse(frontmatter(['a::b::c'])).success).toBe(false);
  });

  it('should reject a key the schema does not name (§3.5)', () => {
    expect($SkillFrontmatter.safeParse({ ...frontmatter(), tool: ['mail'] }).success).toBe(false);
  });
});
