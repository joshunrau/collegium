# E2E Tests

Each run brings up its own Docker Compose project (`e2e/compose.yaml`, named
`collegium-e2e-<pid>-<timestamp>`): a Mattermost container and the throwaway Postgres it talks to.
Nothing is shared with the host — Postgres keeps its data on tmpfs and both containers, their
network, and their storage are removed at teardown. A crashed run can leave a project behind;
`docker compose --project-name <name> down --volumes` clears it.

The app under test still runs on the host, so Mattermost reaches it at `host.docker.internal` —
the one name Docker gives a container for the host it runs on, resolved through `extra_hosts` so it
also works on Linux. This is the one deployment where the address the app binds is not the address
it is reached at, so the harness sets `APP_PUBLIC_URL` to that name; approval callbacks and slash
commands travel back over it.

The Mattermost image is built from `docker/mattermost` by `e2e/support/cluster.ts` — the same image the
shipped stack runs — and tagged with the hash of its build
context, so it is rebuilt only when that context changes.

## One-time setup

Install Docker (Docker Desktop, OrbStack, or the Docker Engine on Linux) and make sure the daemon
is running.

## Running

```sh
pnpm test:e2e
```

Overrides: `E2E_MATTERMOST_PORT` (default 8065).
