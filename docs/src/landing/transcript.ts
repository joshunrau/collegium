type TranscriptAuthor = 'clara' | 'orchestrator' | 'theo';

type ToolLine = {
  detail: string;
  tool: string;
};

type MailPanel = {
  body: string;
  from: string;
  subject: string;
};

type ApprovalPanel = {
  approvedAt: string;
  approvedBy: string;
  paragraphs: string[];
  subject: string;
  to: string;
};

type TranscriptTurn = (
  | { approval: ApprovalPanel; kind: 'approval' }
  | { kind: 'mail'; mail: MailPanel; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tools'; tools: ToolLine[] }
) & {
  at: string;
  author: TranscriptAuthor;
};

const TRANSCRIPT: TranscriptTurn[] = [
  {
    at: '10:02 AM',
    author: 'orchestrator',
    kind: 'mail',
    mail: {
      body: "Hi! Planning for next June has started, and we'd love to have you back as a sponsor. This year's tiers are up on our site. Any interest in returning?",
      from: 'elena@northshoresummit.co',
      subject: 'Sponsoring Northshore Summit 2027'
    },
    text: 'New mail for @clara'
  },
  {
    at: '10:02 AM',
    author: 'clara',
    kind: 'tools',
    tools: [
      { detail: 'opened "Sponsoring Northshore Summit 2027" from elena@northshoresummit.co', tool: 'mail' },
      { detail: 'northshore summit 2026: silver tier, booth skipped', tool: 'read_memory' }
    ]
  },
  {
    at: '10:03 AM',
    author: 'clara',
    kind: 'text',
    text: "@theo can you pull the 2027 sponsor tiers from northshoresummit.co? I need silver's price and what it includes."
  },
  {
    at: '10:03 AM',
    author: 'theo',
    kind: 'tools',
    tools: [{ detail: 'northshoresummit.co → Sponsors → 2027 tiers', tool: 'browser' }]
  },
  {
    at: '10:05 AM',
    author: 'theo',
    kind: 'text',
    text: '@clara Silver is $4,000 for 2027: logo placement, two passes, and a careers-page listing. Gold is $8,500 and adds a booth. Silver is up $500 from last year.'
  },
  {
    approval: {
      approvedAt: '10:31 AM',
      approvedBy: 'maya',
      paragraphs: [
        'Hi Elena,',
        "Good to hear from you. We had a great experience last year and would like to return at silver. I see it is $4,000 for 2027; could you send the agreement over? One request: we'd like the careers-page listing live ahead of the conference this time.",
        'Thanks,',
        'Clara'
      ],
      subject: 'Re: Sponsoring Northshore Summit 2027',
      to: 'elena@northshoresummit.co'
    },
    at: '10:06 AM',
    author: 'clara',
    kind: 'approval'
  },
  {
    at: '10:31 AM',
    author: 'clara',
    kind: 'text',
    text: "Sent. I noted the $500 increase for next year's budgeting."
  }
];

const DISPLAY_NAMES: { [K in TranscriptAuthor]: string } = {
  clara: 'Clara',
  orchestrator: 'Orchestrator',
  theo: 'Theo'
};

function displayName(author: TranscriptAuthor): string {
  return DISPLAY_NAMES[author];
}

function splitMentions(text: string): { isMention: boolean; value: string }[] {
  return text
    .split(/((?<=^|\s)@[a-z]+)/g)
    .filter((value) => value.length > 0)
    .map((value) => ({ isMention: value.startsWith('@'), value }));
}

export { displayName, splitMentions, TRANSCRIPT, type TranscriptAuthor, type TranscriptTurn };
