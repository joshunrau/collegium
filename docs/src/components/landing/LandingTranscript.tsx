import { useRef } from 'react';

import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';

import claraAvatar from '@/assets/headshots/clara.png';
import orchestratorAvatar from '@/assets/headshots/orchestrator.png';
import theoAvatar from '@/assets/headshots/theo.png';

type ApprovalPanel = {
  approvedAt: string;
  approvedBy: string;
  paragraphs: string[];
  subject: string;
  to: string;
};

type ToolLine = {
  detail: string;
  tool: string;
};

type TranscriptAuthor = 'clara' | 'orchestrator' | 'theo';

namespace TranscriptTurn {
  interface Base {
    at: string;
    author: TranscriptAuthor;
  }

  export interface Approval extends Base {
    approval: ApprovalPanel;
    kind: 'approval';
  }

  export interface Mail extends Base {
    kind: 'mail';
    mail: {
      body: string;
      from: string;
      subject: string;
    };
    text: string;
  }

  export interface Text extends Base {
    kind: 'text';
    text: string;
  }

  export interface Tools extends Base {
    kind: 'tools';
    tools: ToolLine[];
  }

  export type Any = Approval | Mail | Text | Tools;
}

type TranscriptTurn = TranscriptTurn.Any;

const AVATARS: { [K in TranscriptAuthor]: ImageMetadata } = {
  clara: claraAvatar,
  orchestrator: orchestratorAvatar,
  theo: theoAvatar
};

const DISPLAY_NAMES: { [K in TranscriptAuthor]: string } = {
  clara: 'Clara',
  orchestrator: 'Orchestrator',
  theo: 'Theo'
};

/* Rows sharpen to full focus in a band around the middle of the viewport and fall away above and below it. */
const ROW_BAND = [0, 0.38, 0.55, 1];

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

function turnKey(turn: TranscriptTurn) {
  return `${turn.author}-${turn.at}-${turn.kind}`;
}

const Mentions: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(@\w+)/g).map((part, i) =>
      part.startsWith('@') ? (
        <span className="font-medium" key={i}>
          {part}
        </span>
      ) : (
        part
      )
    )}
  </>
);

const TurnBody: React.FC<{ turn: TranscriptTurn }> = ({ turn }) => {
  switch (turn.kind) {
    case 'approval':
      return (
        <div className="border-lp-accent flex flex-col gap-2 border-l-2 pl-4 text-sm leading-relaxed">
          <p className="font-lp-mono text-lp-accent text-xs tracking-wide">approval required · send mail</p>
          <p className="font-lp-mono text-lp-muted text-xs break-all">
            to {turn.approval.to} · {turn.approval.subject}
          </p>
          <div className="flex flex-col gap-2">
            {turn.approval.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <p className="font-lp-mono text-lp-muted text-xs">
            ✓ approved by Maya · <span className="tabular-nums">{turn.approval.approvedAt}</span>
          </p>
        </div>
      );
    case 'mail':
      return (
        <div className="flex flex-col gap-2 text-sm leading-relaxed">
          <p>
            <Mentions text={turn.text} />
          </p>
          <p className="font-lp-mono text-lp-muted text-xs break-all">
            {turn.mail.from} · {turn.mail.subject}
          </p>
          <p className="text-lp-muted">{turn.mail.body}</p>
        </div>
      );
    case 'text':
      return (
        <p className="text-sm leading-relaxed">
          <Mentions text={turn.text} />
        </p>
      );
    case 'tools':
      return (
        <ul className="font-lp-mono grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs leading-relaxed">
          {turn.tools.map((line) => (
            <li className="col-span-2 grid grid-cols-subgrid" key={line.tool}>
              <span className="font-medium">{line.tool}</span>
              <span className="text-lp-muted wrap-break-word">{line.detail}</span>
            </li>
          ))}
        </ul>
      );
    default:
      return turn satisfies never;
  }
};

const Row: React.FC<{ reduceMotion: boolean; turn: TranscriptTurn }> = ({ reduceMotion, turn }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ offset: ['start end', 'end start'], target: ref });
  const opacity = useTransform(scrollYProgress, ROW_BAND, [0.3, 1, 1, 0.3]);
  const scale = useTransform(scrollYProgress, ROW_BAND, [0.98, 1, 1, 0.98]);
  const filter = useTransform(scrollYProgress, ROW_BAND, ['blur(2.5px)', 'blur(0px)', 'blur(0px)', 'blur(2.5px)']);
  const ignite = useTransform(scrollYProgress, [0.3, 0.38, 0.55, 0.63], [0, 1, 1, 0]);
  const avatarFilter = useTransform(scrollYProgress, ROW_BAND, [
    'grayscale(1)',
    'grayscale(0)',
    'grayscale(0)',
    'grayscale(1)'
  ]);
  return (
    <motion.div
      className="grid grid-cols-[4rem_1.5rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[4.5rem_1.5rem_minmax(0,1fr)] sm:gap-x-5"
      ref={ref}
      style={reduceMotion ? undefined : { filter, opacity, scale }}
    >
      <p className="font-lp-mono text-lp-muted pt-1.5 text-right text-xs whitespace-nowrap tabular-nums">{turn.at}</p>
      <div className="flex justify-center">
        <div className="relative mt-2 size-2.5">
          <div aria-hidden="true" className="border-lp-border bg-lp-background absolute inset-0 rounded-full border" />
          <motion.div
            aria-hidden="true"
            className="bg-lp-accent absolute inset-0 rounded-full"
            style={{ opacity: reduceMotion ? (turn.kind === 'approval' ? 1 : 0) : ignite }}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2.5 pb-14">
        <div className="flex items-center gap-2.5">
          <motion.img
            alt={DISPLAY_NAMES[turn.author]}
            className={`border-lp-border size-7 shrink-0 border object-cover ${
              turn.author === 'orchestrator' ? 'rounded-md opacity-80 saturate-[0.65]' : 'rounded-full'
            }`}
            src={AVATARS[turn.author].src}
            style={reduceMotion ? undefined : { filter: avatarFilter }}
          />
          <p className={`text-sm font-semibold ${turn.author === 'orchestrator' ? 'text-lp-muted' : ''}`}>
            {DISPLAY_NAMES[turn.author]}
          </p>
        </div>
        <TurnBody turn={turn} />
      </div>
    </motion.div>
  );
};

export const LandingTranscript = () => {
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <section className="mx-auto w-full max-w-3xl scroll-mt-20 pb-24" id="transcript">
      <header className="mb-14">
        <p className="font-lp-mono text-lp-muted text-xs tracking-widest">transcript · #partnerships</p>
        <h2 className="font-lp-serif mt-3 text-3xl tracking-tight">Every Step Is a Post</h2>
      </header>
      <div className="relative">
        <div aria-hidden="true" className="bg-lp-border absolute top-1 bottom-14 left-22 w-px sm:left-26" />
        {TRANSCRIPT.map((turn) => (
          <Row key={turnKey(turn)} reduceMotion={reduceMotion} turn={turn} />
        ))}
      </div>
    </section>
  );
};
