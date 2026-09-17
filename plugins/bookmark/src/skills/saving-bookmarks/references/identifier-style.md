---
description: How to derive a bookmark identifier, and what to do when one is taken.
title: Bookmark identifier style
---

An identifier is how a human asks for a bookmark back weeks later, so it is written for them, not
for the address.

- Derive it from the subject, not the domain: `quarterly-forecast`, not `docs-google-com`.
- Keep it short and lowercase, words joined by dashes. Two or three words is usually enough.
- Prefer the noun a human would say out loud. If you would have to read the URL to recognise it, the
  identifier is wrong.
- Do not encode dates or versions unless the human named one. A bookmark that is replaced later is
  deleted and saved again, not versioned in its identifier.

A taken identifier is refused rather than overwritten. Do not append a number — that produces
`forecast-2`, which nobody can ask for. Narrow the subject instead: `forecast` taken becomes
`forecast-emea`.
