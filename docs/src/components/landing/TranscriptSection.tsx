import { useRef } from 'react';

import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';

type TranscriptAuthor = {
  avatar: ImageMetadata;
  name: string;
  system?: boolean;
};

type TurnBase = {
  at: string;
  author: TranscriptAuthor;
};

type ApprovalTurn = TurnBase & {
  approval: {
    action: string;
    approvedAt: string;
    approvedBy: string;
    paragraphs: string[];
    subject: string;
    to: string;
  };
  kind: 'approval';
};

type MailTurn = TurnBase & {
  kind: 'mail';
  mail: {
    body: string;
    from: string;
    subject: string;
  };
  text: string;
};

type TextTurn = TurnBase & {
  kind: 'text';
  text: string;
};

type ToolsTurn = TurnBase & {
  kind: 'tools';
  tools: {
    detail: string;
    tool: string;
  }[];
};

type TranscriptTurn = ApprovalTurn | MailTurn | TextTurn | ToolsTurn;

interface Props {
  heading: string;
  id: string;
  kicker: string;
  turns: TranscriptTurn[];
}

/* Rows sharpen to full focus in a band around the middle of the viewport and fall away above and below it. */
const ROW_BAND = [0, 0.38, 0.55, 1];

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
          <p className="font-lp-mono text-lp-accent text-xs tracking-wide">
            approval required · {turn.approval.action}
          </p>
          <p className="font-lp-mono text-lp-muted text-xs break-all">
            to {turn.approval.to} · {turn.approval.subject}
          </p>
          <div className="flex flex-col gap-2">
            {turn.approval.paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
          <p className="font-lp-mono text-lp-muted text-xs">
            ✓ approved by {turn.approval.approvedBy} · <span className="tabular-nums">{turn.approval.approvedAt}</span>
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
          {turn.tools.map((line, index) => (
            <li className="col-span-2 grid grid-cols-subgrid" key={index}>
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
            alt={turn.author.name}
            className={`border-lp-border size-7 shrink-0 border object-cover ${
              turn.author.system ? 'rounded-md opacity-80 saturate-[0.65]' : 'rounded-full'
            }`}
            src={turn.author.avatar.src}
            style={reduceMotion ? undefined : { filter: avatarFilter }}
          />
          <p className={`text-sm font-semibold ${turn.author.system ? 'text-lp-muted' : ''}`}>{turn.author.name}</p>
        </div>
        <TurnBody turn={turn} />
      </div>
    </motion.div>
  );
};

export const TranscriptSection: React.FC<Props> = ({ heading, id, kicker, turns }) => {
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <section className="mx-auto w-full max-w-3xl scroll-mt-20 pb-24" id={id}>
      <header className="mb-14">
        <p className="font-lp-mono text-lp-muted text-xs tracking-widest">{kicker}</p>
        <h2 className="font-lp-serif mt-3 text-3xl tracking-tight">{heading}</h2>
      </header>
      <div className="relative">
        <div aria-hidden="true" className="bg-lp-border absolute top-1 bottom-14 left-22 w-px sm:left-26" />
        {turns.map((turn, index) => (
          <Row key={index} reduceMotion={reduceMotion} turn={turn} />
        ))}
      </div>
    </section>
  );
};
