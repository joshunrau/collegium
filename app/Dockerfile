# syntax=docker/dockerfile:1

# Debian, not Alpine: Camoufox ships one glibc build per architecture and no musl variant.
FROM node:krypton-trixie-slim AS base
WORKDIR /srv

# Camoufox otherwise unpacks into the building user's cache, which the runtime user cannot read: the
# app boots healthy and every browser action fails as unreachable.
ENV CAMOUFOX_INSTALL_DIR="/opt/camoufox"
# the Prisma CLI phones home on every invocation, and the entrypoint runs it at every start
ENV CHECKPOINT_DISABLE=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"
RUN corepack enable

FROM base AS prune
ARG TURBO_TELEMETRY_DISABLED=1
COPY . .
RUN <<EOF
  set -e
  TURBO_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf-8')).devDependencies.turbo || '');")
  if [ -z "$TURBO_VERSION" ]; then
    echo "Error: Could not extract turbo version from package.json" >&2
    exit 1
  fi
  pnpm install -g "turbo@${TURBO_VERSION}"
EOF
RUN turbo prune @collegium/app --docker

FROM base AS build
ARG TURBO_TELEMETRY_DISABLED=1
# NODE_ENV stays unset: at "production" pnpm omits the devDependencies the build is made of.
# Any well-formed URL satisfies prisma.config.ts, which resolves it at load time and never connects.
# It belongs to this stage alone: inherited by the run stage it would answer for a DATABASE_URL the
# operator never set, and the entrypoint would take /dev for the store's directory.
ENV DATABASE_URL="file:/dev/null"
# better-sqlite3 publishes no bundled binary for arm64 and compiles from source when its download comes up
# empty; the toolchain serves that fallback alone and stays behind in this stage.
RUN apt-get update && apt-get install --yes --no-install-recommends g++ make python3 && rm -rf /var/lib/apt/lists/*
COPY --from=prune /srv/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /srv/out/full/ .
# turbo prune carries the workspace packages alone; the config every package extends sits at the root
COPY tsconfig.base.json ./
# the SDK's declaration bundling outgrows the heap Node sizes itself for a container, and aborts the
# build with SIGABRT rather than a message naming memory
ENV NODE_OPTIONS="--max-old-space-size=8192"
RUN pnpm exec turbo build

FROM base AS run
ENV NODE_ENV=production
COPY --from=build $CAMOUFOX_INSTALL_DIR $CAMOUFOX_INSTALL_DIR
COPY --from=build /srv /srv

# the app package, not the workspace root: the entrypoint resolves the Prisma CLI and its
# prisma.config.ts from the working directory, and both are the app's own. The tree above stays the
# entrypoint's APP_ROOT, which is what §6.1 confinement is applied to.
WORKDIR /srv/app

# sudo is the whole of the shell tool's privilege (§A2). Firefox's shared libraries are resolved by
# the browser vendor's own matrix rather than a hand-kept list.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends sudo \
  && pnpm exec playwright-core install-deps firefox \
  && rm -rf /var/lib/apt/lists/*

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch(`http://${process.env.APP_HOST}:${process.env.APP_PORT}/health`).then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "dist/entrypoint.js"]

