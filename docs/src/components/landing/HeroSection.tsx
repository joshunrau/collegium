import { motion, useReducedMotion } from 'motion/react';
import type { Variants } from 'motion/react';

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } }
};

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, transition: { duration: 0.5, ease: 'easeOut' }, y: 0 }
};

type Link = {
  href: string;
  label: string;
};

interface Props {
  headline: {
    code: string;
    lead: string;
  };
  kicker: string;
  primaryCta: Link;
  scrollHint: Link;
  secondaryCta: Link;
  subhead: string;
}

export const HeroSection: React.FC<Props> = ({ headline, kicker, primaryCta, scrollHint, secondaryCta, subhead }) => {
  const reduceMotion = useReducedMotion();
  return (
    <section className="relative flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center text-center">
      <motion.div
        animate="visible"
        className="flex flex-col items-center gap-6"
        initial={reduceMotion ? false : 'hidden'}
        variants={container}
      >
        <motion.p className="font-lp-mono text-lp-muted text-xs tracking-widest" variants={item}>
          {kicker}
        </motion.p>
        <motion.h1
          className="font-lp-serif max-w-4xl text-5xl leading-[1.05] tracking-tight text-balance sm:text-6xl md:text-7xl"
          variants={item}
        >
          {headline.lead} <span className="font-lp-mono text-lp-accent text-[0.8em]">{headline.code}</span>
        </motion.h1>
        <motion.p className="text-lp-muted mx-auto max-w-xl leading-relaxed text-balance sm:text-lg" variants={item}>
          {subhead}
        </motion.p>
        <motion.div className="flex flex-wrap justify-center gap-3" variants={item}>
          <a
            className="bg-lp-text text-lp-background focus-visible:outline-lp-accent rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
            href={primaryCta.href}
          >
            {primaryCta.label}
          </a>
          <a
            className="border-lp-border hover:bg-lp-surface focus-visible:outline-lp-accent rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            href={secondaryCta.href}
          >
            {secondaryCta.label}
          </a>
        </motion.div>
      </motion.div>
      <motion.a
        animate={{ opacity: 1 }}
        className="font-lp-mono text-lp-muted hover:text-lp-text focus-visible:outline-lp-accent absolute inset-x-0 bottom-8 mx-auto w-fit text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        href={scrollHint.href}
        initial={reduceMotion ? false : { opacity: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
      >
        {scrollHint.label}
      </motion.a>
    </section>
  );
};
