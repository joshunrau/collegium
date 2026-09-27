---
name: writing-reports
description: Write up the findings of a review, audit, investigation, or research task as a report for the user. Use when handing over the results of a long or multi-agent task as a document. Not for chat replies, progress updates, or documentation pages.
---

# Writing Reports

Apply this guidance when writing a report for the user to review. Unless otherwise specified, write the report as a Markdown file in the project, at the path the user named or a sensible default, using headings, paragraphs, lists, and code fences. Tables are banned throughout, including appendices.

## Structure

Open with a title and one line giving the date and the state of the subject, such as the commit reviewed. Then four parts, in this order.

### Summary

One to three brief paragraphs of prose that orient the reader, who keeps reading afterwards. State the task, the approach in general terms, what was found in general terms, and the overall conclusion (e.g., how many recommendations there are and how they divide by severity). Where something examined turned out sound, say so in a sentence rather than inventorying what works. 

### Findings

What was found, stated objectively, with no recommendations. Choose the grouping that fits the task: by area when there are many findings, by severity when there are few.

Each finding is a short paragraph: the defect, where it lives, how it was established (observed, reproduced, or inferred from reading), and its severity in a word. Where confidence is lower, say why in a clause, such as "rests on a single source". Findings that share a cause are one finding with a count; the itemized list goes to an appendix. A reader understands every finding from the report alone; a finding may cite evidence by relative path where a reader might want to check it.

### Recommendations

Ordered by consequence, in tiers chosen for the task, such as blocking versus non-blocking. Each recommendation is one or two sentences in the imperative that name the finding it resolves. Describe what a change touches when that changes how the reader weighs it, such as one line in one file versus every stored record. Duration and schedule are the team's to estimate, never the report's. A choice that depends on facts about the team or business that the report lacks is presented as alternatives with one recommended.

### Appendices

A top-level "Appendices" heading marks the boundary. An appendix exists because the body points to it; material nothing in the body needs is cut, not appended. Appendices are looked up, not read through: itemized lists, per-finding evidence, reference material, deferred items, and an index of the evidence files. At minimum, one appendix is required: how the work was done and its limitations, including which claims were inferred from reading rather than observed.

## Throughout

- Every reference points backward (with the exception of references to an Appendix). A thing is named only after it has been described.
- Plain technical prose, in the first person where the report gives its own judgement. State the fact; emphasis comes from tier and position, not from framing, editorializing, rhetorical questions, or figurative language.
- A number about the subject stays when it changes what the reader concludes or does. The work's own effort is described without counts: no screenshots taken, sources read, or agents spawned.
- Conclusions are the report's own. How a position changed, or which agent held which view, stays out; confidence is stated on the finding itself, and method detail goes in the required appendix.
- Side effects of producing the report, such as test data created, files written, or credentials read, go in the chat message that hands over the report.

## Tone and Style
- One topic per paragraph
- One idea per sentence, usually under 20 words. Keep a dependent idea in one sentence rather than splitting it into fragments.
- Always use active voice. Test: append "by monkeys"; if the sentence still parses, rewrite it.
- Earn every detail: cut a number, name, or implementation detail if a more general phrasing would not change the reader's understanding or action.
- Use lists for parallel items and sequences; paragraphs for reasoning.
