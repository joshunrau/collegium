#!/usr/bin/env bash
# docker compose against the benchmark stack, from any working directory:
#   benchmark/scripts/stack.sh up -d --build
#   benchmark/scripts/stack.sh down
#   benchmark/scripts/stack.sh cp app:/tmp/snapshot.db ./snapshot.db
set -euo pipefail
stack_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../stack" && pwd)"
exec docker compose --project-directory "$stack_dir" --env-file "$stack_dir/bench.env" "$@"
