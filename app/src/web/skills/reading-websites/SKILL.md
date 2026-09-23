---
description: 'Read a website: which tool first, finding a field in a long page, reaching a page without guessing its URL, what a blocked or missing page means. Load before your first web__fetch or web__navigate.'
title: Reading websites
tools: [web::fetch]
---

## Reach the page from something you read

Open an address you have read: a search result, a link on a page, or the site's own index, directory
or search. An address you put together yourself, such as a name slotted into a `/people/` path or a
`?page=2` added to a listing, is a guess, and guesses are where nearly every 404 comes from. When
the page you want is somewhere on a site, fetch the page that lists it and `find` the name there;
where the site has a search box and you hold `web__navigate`, navigate to it and search.

Done when every address you open came off a result or a page you have read.

## Fetch first

`web__fetch` is the cheap read: no browser, no session, and fetches made in one response run
together. Start there. If you hold `web__navigate`, switch to it when a fetch says the page has no
static content or the site turned it away, or when the task needs a click, a form or a sign-in.
Without it, such a page is out of your reach: say so rather than fetching it again.

## Find the field, then read around it

For one field, such as an email address, a phone number, a title or a date, pass `find` with a few
phrases that sit beside it: a surname, "email", "@". Each place found comes with the text around it
and its offset. When that text does not hold the answer, read a small window from the offset with
`startChar` and `maxChars`. Read a page whole only when the whole page is what you need.

A result that stops short says where to read on. Fetch again from that `startChar`; a fetch from the
top returns what you already have. A fetch leaves out a page's navigation, header and footer, and
says how much it left out; a contact address often lives in the footer, and `wholePage: true` reads
it. Offsets from a read with `wholePage` do not apply to one without.

Done when every value you report was read on a page, not inferred from a pattern.

## What a result is telling you

- **Blocked.** The site turned away a read without a browser, and the body describes the refusal,
  not the page. A bot check or a CDN's refusal page is what `web__navigate`, if you hold it, gets
  past most often, since the browser runs the check. A 401 wants a sign-in, and a 429 wants you to
  wait: read something else before you return to that site. If the browser is refused too, or you
  hold none, the site is closed to you; say so rather than fetching it again.
- **404 or 410.** On an address you read off a page, the page is gone. On one you built, it proves
  nothing: go back to the site's index or search.
- **A PDF.** `web__fetch` reads its text layer, each page under a `[page N of M]` marker, and `find`
  works in it. A scanned PDF has no text layer and says so; no web tool reads more of it.
- **Identical content to an earlier read.** This address served a page you already have, so the
  site ignored whatever you changed in the URL. Follow the site's own link to the next page rather
  than varying the address again.
