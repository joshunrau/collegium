/// <reference types="node" />

// @ts-check

/**
 * Writes fifteen monthly minutes pages and their index: one approved expenditure per month, so a
 * task that needs every page at once has an exact answer (the total and the largest month).
 * Deterministic; the pages are small enough to commit.
 *
 *   node benchmark/scripts/render-minutes.js
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const MONTHS = [
  ['2024-10', 'October 2024', 4820],
  ['2024-11', 'November 2024', 1275],
  ['2024-12', 'December 2024', 9640],
  ['2025-01', 'January 2025', 3110],
  ['2025-02', 'February 2025', 760],
  ['2025-03', 'March 2025', 12485],
  ['2025-04', 'April 2025', 2390],
  ['2025-05', 'May 2025', 5575],
  ['2025-06', 'June 2025', 1980],
  ['2025-07', 'July 2025', 640],
  ['2025-08', 'August 2025', 7305],
  ['2025-09', 'September 2025', 15220],
  ['2025-10', 'October 2025', 2860],
  ['2025-11', 'November 2025', 4415],
  ['2025-12', 'December 2025', 6090]
];

const ITEMS = [
  'Approval of the previous minutes',
  'Graduate admissions update',
  'Seminar series planning',
  'Laboratory space allocation',
  'Equipment requests',
  'Teaching assignments for the coming term',
  'Ethics board correspondence',
  'Visiting scholar arrangements'
];

const head = (title) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} — Department of Psychological Science — Northmoor University</title>
  </head>
  <body>`;

const dir = path.join(import.meta.dirname, '..', 'fixtures', 'northmoor', 'minutes');
fs.mkdirSync(dir, { recursive: true });

let total = 0;
for (const [index, [slug, label, amount]] of MONTHS.entries()) {
  total += amount;
  const agenda = [ITEMS[index % ITEMS.length], ITEMS[(index + 3) % ITEMS.length], ITEMS[(index + 5) % ITEMS.length]];
  const previous = index > 0 ? `<a href="${MONTHS[index - 1][0]}.html">← ${MONTHS[index - 1][1]}</a>` : '';
  const next = index < MONTHS.length - 1 ? `<a href="${MONTHS[index + 1][0]}.html">${MONTHS[index + 1][1]} →</a>` : '';
  const page = `${head(`Minutes, ${label}`)}
    <h1>Departmental meeting minutes — ${label}</h1>
    <p>Department of Psychological Science, Northmoor University. Meeting ${index + 1} of ${MONTHS.length} in this series.</p>
    <h2>Agenda</h2>
    <ol>
${agenda.map((item) => `      <li>${item}</li>`).join('\n')}
    </ol>
    <h2>Decisions</h2>
    <p>The committee approved an expenditure of <strong>$${amount.toLocaleString('en-CA')}</strong> from the departmental fund.</p>
    <p>Minutes taken by the departmental administrator and approved at the following meeting.</p>
    <nav>${previous} <a href="index.html">All minutes</a> ${next}</nav>
  </body>
</html>
`;
  fs.writeFileSync(path.join(dir, `${slug}.html`), page);
}

const index = `${head('Meeting Minutes')}
    <h1>Departmental meeting minutes</h1>
    <p>Department of Psychological Science, Northmoor University. One page per monthly meeting, ${MONTHS.length} meetings in all.</p>
    <ul>
${MONTHS.map(([slug, label]) => `      <li><a href="${slug}.html">${label}</a></li>`).join('\n')}
    </ul>
  </body>
</html>
`;
fs.writeFileSync(path.join(dir, 'index.html'), index);
const largest = MONTHS.reduce((best, month) => (month[2] > best[2] ? month : best));
console.log(`wrote ${MONTHS.length} pages + index; total $${total}; largest ${largest[1]} $${largest[2]}`);
