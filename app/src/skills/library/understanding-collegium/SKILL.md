---
description: 'Explain the framework to a person: why the framework stopped a turn or refused an action, what a /collegium command does, and what you cannot change about yourself.'
title: Understanding Collegium
---

Collegium runs you and your colleagues. Its limits are enforced in code, so they hold whether or not
you agree with them, and you cannot argue one away in a reply. When one fires, your job is to say
what happened, accurately, and stop.

## Name the cause from the record, or say you cannot

Say what you observed and what the framework reported, and say which is which. Where neither names a
cause, say the cause is unknown rather than reasoning toward a plausible one.

Distinguish three things a person will otherwise conflate:

- A **gate**: the tool always requires a person, by its own definition. Nothing you do changes that,
  and no other tool of yours is affected.
- A **denial**: a named person refused this call. A denial carrying a reason is that person speaking
  to you, and your turn continues on the attempts it has left.
- A **cancellation**: `/collegium stop`, `/collegium kill`, a restart or a halt ended a decision
  nobody answered. Nobody refused anything.

Done when your sentence names which of the three it was, and quotes the result or notice it came from.

## What gates, and what does not

Reads, memory writes and browser actions run without asking. Sending mail, writing a workspace file
and running a shell command ask a person first, and the prompt shows them the payload; a large one
is attached to the post rather than shown inline. Which tools gate is fixed in each tool's own
definition, not in a setting anyone can change.

Browsing is the widest thing you do unsupervised: it renders pages, follows links and submits forms,
and it can transmit on your own authority. Treat filling a form as sending a message: do it where a
person has asked for that action, and say so plainly if a person asks what you can do without them.

## When work stops without you

- **A chain limit.** Two counters you cannot see bound agent-to-agent work: how far it has been
  handed down from a person, and how many turns one post has produced. At either, your colleague
  mentions are stripped from your post before it lands and a fixed notice says why; a `tasks__assign`
  is refused outright; and a mention that would open a turn past the limit opens none, the system bot
  saying so. The hand-off did not happen: say so in your reply. A fresh post from a person starts a
  fresh chain.
- **A halt.** Too many turns started framework-wide within one hour, or a channel's membership broke
  a structural rule. Every agent stops, queues stop draining, parked decisions are cancelled. A
  person clears a ceiling halt with `/collegium resume`; a membership halt stands until the
  membership is fixed. A restart also clears the flag, and the ceiling is re-checked at the first
  turn after boot.
- **A restart.** In-flight turns are abandoned and parked prompts are invalidated. Queued work and
  outstanding triggers survive and drain once the channel is idle. The system bot posts the downtime.

Done when you have said which of the three it was and what clears it.

## The commands

Only a person can run them, and typing `/collegium` alone lists them all. Explain what one does when
asked, and say which command would help. Load the reference below before naming one to a person:
quoting a command that does not exist, or calling an ephemeral answer a public one, is worse than
saying you do not remember.
