type Posture = {
  body: string;
  title: string;
};

type Refusal = {
  /** What is given up. Set opposite the claim, under an amber rule. */
  cost: string;
  title: string;
  what: string;
};

export const POSTURES: Posture[] = [
  {
    body: "Agents live in your team's channels. The work, the tool calls, the questions, and the results all land in the conversation. If work is happening, there is a post you can scroll to.",
    title: 'Everything Happens in Your Chat'
  },
  {
    body: 'Anything that leaves a mark stops and asks first: the exact email before it is sent, the exact file before it is written. You see the full payload, then approve it, deny it, or deny it with a reason the agent can act on.',
    title: 'Consequential Actions Wait for You'
  },
  {
    body: 'An agent holds exactly the tools its role requires and nothing more. There is no shell access by default, and no way for an agent to grow its own reach. What an agent can touch is a fact you can read in its configuration.',
    title: 'Capabilities Are Granted, Never Ambient'
  },
  {
    body: 'Agents act when a person addresses them, or when deterministic code you configured announces work. Never on their own initiative. And when anything goes wrong, they stop and say so: no silent retries, no improvised workarounds, no quietly degraded answers.',
    title: 'Deterministic Starts, Clean Stops'
  }
];

export const REFUSALS: Refusal[] = [
  {
    cost: 'Idle agents do nothing. That is the point. An agent with initiative and idle cycles finds work nobody asked for.',
    title: "Agents Don't Schedule Themselves",
    what: 'Nothing happens unless a person addresses an agent, or a trigger you configured announces work in the channel.'
  },
  {
    cost: 'Improving an agent is your change to make, not something the system learns on its own. In return, the agent you reviewed yesterday is the agent running today.',
    title: "Agents Don't Modify Themselves",
    what: 'No agent can edit its own instructions, tools, or schedule.'
  },
  {
    cost: 'Throughput. Big jobs proceed one visible conversation at a time, not as a swarm. In return, nothing is ever done by a worker that no longer exists to answer for it.',
    title: "Agents Don't Spawn Workers",
    what: 'Every actor has a durable name, and its work is in a channel.'
  },
  {
    cost: 'We would rather interrupt you than be quietly wrong for six hours.',
    title: 'Agents Stop Instead of Degrading',
    what: 'A denied action, a malformed response, an ambiguous outcome: each one ends the turn with a visible notice. In a coding agent, retrying a flaky call is helpful. When the flaky call was an email to your client, a retry is a duplicate email.'
  }
];
