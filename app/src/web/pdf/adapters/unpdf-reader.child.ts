/**
 * The reader: one PDF's text layer, read by PDF.js in a process of its own and written to standard
 * output a page at a time, so the server keeps whatever was read when it kills this process at the
 * read's deadline or past its memory cap (§3.4). It is run as a script and never imported, so it
 * imports nothing through the app's path aliases, which resolve only under the app's own loader.
 */

import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { buffer } from 'node:stream/consumers';
import { Worker } from 'node:worker_threads';

import { getDocumentProxy } from 'unpdf';

import { $UnpdfReaderOrders } from './unpdf-reader.schemas.ts';

import type { $UnpdfReaderMessage } from './unpdf-reader.schemas.ts';

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/** PDF.js's own level for errors alone: its warnings would otherwise reach standard output, which carries the pages */
const ERRORS_ONLY = 0;

/** a thread of its own, since a page stuck in a synchronous inflate stops every timer on the reader's */
const MEMORY_WATCH = `
const { workerData } = require('node:worker_threads');
setInterval(() => {
  if (process.memoryUsage.rss() > workerData.capBytes) {
    process.kill(process.pid, 'SIGKILL');
  }
}, workerData.intervalMs);
`;

async function send(message: $UnpdfReaderMessage): Promise<void> {
  if (!process.stdout.write(`${JSON.stringify(message)}\n`)) {
    await once(process.stdout, 'drain');
  }
}

async function readPageText(document: PdfDocument, pageNumber: number): Promise<string> {
  const content = await (await document.getPage(pageNumber)).getTextContent();
  return content.items.map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : '')).join('');
}

async function readPages(document: PdfDocument, maxChars: number): Promise<void> {
  const pageCount = document.numPages;
  let chars = 0;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    if (chars >= maxChars) {
      return send({ kind: 'done', pageCount, stoppedBy: 'char-limit' });
    }
    // a single page longer than the whole read's ceiling is cut to it, so no line the server buffers outgrows a read
    const text = (await readPageText(document, pageNumber)).slice(0, maxChars);
    await send({ kind: 'page', pageCount, text });
    chars += text.length;
  }
  return send({ kind: 'done', pageCount });
}

function toUnreadableReason(error: unknown): Extract<$UnpdfReaderMessage, { kind: 'unreadable' }>['reason'] {
  return error instanceof Error && error.name === 'PasswordException' ? 'encrypted' : 'malformed';
}

const orders = $UnpdfReaderOrders.parse(JSON.parse(process.argv[2] ?? 'null'));

// §3.4 — should the kernel's OOM killer act before the server does, it takes this process and not the server
if (process.platform === 'linux') {
  writeFileSync('/proc/self/oom_score_adj', '1000');
}
if (orders.watchOwnMemory) {
  new Worker(MEMORY_WATCH, { eval: true, workerData: orders.watchOwnMemory }).unref();
}

const bytes = new Uint8Array(await buffer(process.stdin));
try {
  await readPages(await getDocumentProxy(bytes, { verbosity: ERRORS_ONLY }), orders.maxChars);
} catch (error) {
  await send({ kind: 'unreadable', reason: toUnreadableReason(error) });
}
