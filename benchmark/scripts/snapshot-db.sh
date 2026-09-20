#!/usr/bin/env bash
# Copy a consistent snapshot of the running stack's SQLite out to the host, for extract.js. The
# store is in WAL mode, so copying the file alone would miss committed pages; VACUUM INTO writes
# one self-contained file, and the app image's Node carries node:sqlite to run it.
#   benchmark/scripts/snapshot-db.sh benchmark/results/<run>/prod.db
set -euo pipefail
target="${1:?usage: snapshot-db.sh <destination file>}"
scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$scripts_dir/stack.sh" exec -T app node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/data/prod.db', { readOnly: true });
  try { require('node:fs').rmSync('/tmp/snapshot.db', { force: true }); } catch {}
  db.exec(\"VACUUM INTO '/tmp/snapshot.db'\");
  db.close();
"
mkdir -p "$(dirname "$target")"
"$scripts_dir/stack.sh" cp app:/tmp/snapshot.db "$target"
echo "snapshot written to $target"
