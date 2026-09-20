// Aggregates reader records into a headline table and a findings digest.
//   node aggregate.mjs <records dir> [round prefix]
import * as fs from 'node:fs';
import * as path from 'node:path';
const dir = process.argv[2];
const prefix = process.argv[3] ?? '';
const records = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f.startsWith(prefix))
  .sort()
  .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) }));
const rows = [];
for (const r of records) {
  const fails = r.checks.filter((c) => c.verdict === 'fail');
  rows.push(
    `| ${r.task} | ${r.model ?? r.agent} | ${r.headline?.value} | ${fails.map((c) => c.id).join(', ') || '-'} | ${(r.subpar ?? []).length} | ${r.metrics?.actionCount ?? ''} | ${r.metrics?.costUsd?.toFixed?.(3) ?? ''} | ${r.metrics?.durationMs ? Math.round(r.metrics.durationMs / 1000) + 's' : ''} |`
  );
}
console.log(
  '| task | model | headline | failed checks | subpar | calls | cost | duration |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    rows.join('\n')
);
const byCause = {};
for (const r of records) {
  for (const c of r.checks.filter((c) => c.verdict === 'fail'))
    (byCause[c.cause ?? 'unattributed'] ??= []).push(
      `${r.task}/${r.model?.split('/').pop()} ${c.id}: ${(c.note ?? c.quote ?? '').replace(/\s+/g, ' ').slice(0, 220)}`
    );
  for (const s of r.subpar ?? [])
    (byCause[`subpar:${s.cause ?? 'unattributed'}`] ??= []).push(
      `${r.task}/${r.model?.split('/').pop()}: ${s.what.replace(/\s+/g, ' ').slice(0, 200)} → ${(s.change ?? '').replace(/\s+/g, ' ').slice(0, 160)}`
    );
}
for (const [cause, items] of Object.entries(byCause).sort()) {
  console.log(`\n### ${cause} (${items.length})`);
  for (const i of items) console.log(`- ${i}`);
}
console.log('\n### observations');
for (const r of records)
  for (const o of r.observations ?? [])
    console.log(`- ${r.task}/${r.model?.split('/').pop()}: ${o.replace(/\s+/g, ' ').slice(0, 240)}`);
