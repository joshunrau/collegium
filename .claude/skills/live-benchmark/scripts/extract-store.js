// Runs inside the app container against its own store, read-only, and prints one JSON document
// holding every row that belongs to the bakeoff channels and test agents. Nothing else leaves.
//   ssh internal.clinivance.com 'docker exec -i collegium node - <channelId>,... <agent>,...' < extract-store.js > raw.json
const { DatabaseSync } = require('node:sqlite');
const channelIds = process.argv[2].split(',');
const agents = process.argv[3].split(',');
const db = new DatabaseSync('/data/prod.db', { readOnly: true });
const marks = (list) => list.map(() => '?').join(', ');
const all = (sql, params) => db.prepare(sql).all(...params);
const turns = all(`SELECT * FROM "Turn" WHERE "channelId" IN (${marks(channelIds)}) ORDER BY "startedAt"`, channelIds);
const turnIds = turns.map((t) => t.id);
const byTurn = (table) =>
  turnIds.length === 0
    ? []
    : all(`SELECT * FROM "${table}" WHERE "turnId" IN (${marks(turnIds)}) ORDER BY "turnId", "createdAt"`, turnIds);
const events =
  turnIds.length === 0
    ? []
    : all(`SELECT * FROM "TurnEvent" WHERE "turnId" IN (${marks(turnIds)}) ORDER BY "turnId", "sequence"`, turnIds);
const posts = all(`SELECT * FROM "Post" WHERE "channelId" IN (${marks(channelIds)}) ORDER BY "createdAt"`, channelIds);
const units = all(
  `SELECT * FROM "WorkUnit" WHERE "channelId" IN (${marks(channelIds)}) ORDER BY "createdAt"`,
  channelIds
);
const memories = all(`SELECT * FROM "Memory" WHERE "agentUsername" IN (${marks(agents)}) ORDER BY "createdAt"`, agents);
process.stdout.write(
  JSON.stringify({
    extractedAt: new Date().toISOString(),
    turns,
    events,
    posts,
    approvals: byTurn('Approval'),
    asks: byTurn('Ask'),
    units,
    memories
  })
);
