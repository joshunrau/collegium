# Auditing an agent's output against its sources

A trace holds the arguments of every call and the result of every call. An agent's written value is
therefore testable: either the agent read the value from a source in the same turn, or the agent
produced the value itself. This is the difference between a record you can trust and a record you
cannot.

Use this when an agent writes data that a person will act on later. An email address, a price, an
identifier, a citation.

## Method

**1. Write the trace to a file.** Never hold it in context. One trace reaches 550,000 characters.

**2. Split the trace into what the agent wrote and what the agent read.** A line that holds
``called `toolset::tool` with`` is the agent's own output. Every other line is a result, a page, or
framework text. The second group is the haystack.

**3. Extract each written value by brace matching, not by a regular expression.** A pattern such as
`\{.*?\}` stops at the first closing brace. It undercounts calls and it gives no warning. Find the
marker, find the first `{` after it, then count braces up and down to the match. Parse the result as
JSON.

**4. Compare each value against the haystack, case-folded.** Report the total and report every miss
by name.

**5. Read every miss.** A miss is not proof of a fault. A value can come from an earlier turn, or
from a source the agent names in its report. A miss is the list to examine.

## What the counts tell you

**Written values that all appear in the haystack.** The agent transcribes. It does not construct.

**Written values that appear nowhere.** The agent produced them. For an email address or an
identifier this is a fault, and it reaches a person as real data.

**Source values that the agent did not write.** These are the exclusions. Compare the number with
the agent's own report. A large silent gap is the finding: nobody can tell an exclusion the agent
decided from a record the agent missed.

## A trap the method catches

A page can print a template as an example, for example `firstname.lastname@example.edu`. Such a
string is in the haystack, so a written copy of it passes step 4. Read the misses and read the
exact matches of any value that looks like a pattern rather than a person.
