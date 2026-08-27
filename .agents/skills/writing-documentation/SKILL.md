---
name: writing-documentation
description: Writing style for technical documentation. Use when writing or editing any docs-site page, README, guide, tutorial, or reference page. Not for inline code comments or non-technical prose.
---

## Reader

A competent developer who has never seen this project. They know the language and tooling; they do not know this project's terms, architecture, or conventions. Define what is project-specific. Leave general programming concepts unexplained.

## Voice

- Active voice. Test: append "by monkeys"; if the sentence still parses, rewrite it.
- Direct address: `you`, never `the user` or `one can`
- Present tense unless describing future behavior
- Contractions are fine (`you'll`, `it's`)
- Use definite, specific, concrete language

## Prose

- One topic per paragraph
- One idea per sentence, under 20 words. Keep a dependent idea in one sentence rather than splitting it into fragments.
- Lists for parallel items and sequences; paragraphs for reasoning.
- Earn every detail: cut a number, name, or implementation detail if a more general phrasing would not change the reader's understanding or action.
- Match the page type. Guides and tutorials carry steps; design rationale, context, and internal mechanism belong in conceptual pages only.

## Anti-Patterns

- Em dashes (`—`) or dashes (`-`) used as punctuation
- Passive voice
- Rhetorical questions
- Filler words: `very`, `just`, `really`, `simply`
- Summary-style transitions recapping the previous paragraph
