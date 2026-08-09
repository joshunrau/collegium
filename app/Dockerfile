# syntax=docker/dockerfile:1

# Build context is the workspace root: docker build -f app/Dockerfile .

# Debian, not Alpine: Camoufox ships one glibc build per architecture and no musl variant.
FROM node:krypton-trixie-slim AS base
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Camoufox otherwise unpacks into the building user's cache, which the runtime user cannot read: the
# app boots healthy and every browser action fails as unreachable.
ENV CAMOUFOX_INSTALL_DIR="/opt/camoufox"

FROM base AS build

# NODE_ENV stays unset: at "production" pnpm omits the devDependencies the build is made of. Any
# well-formed URL satisfies prisma.config.ts, which resolves it at load time and never connects.
ENV DATABASE_URL="file:/dev/null"

# better-sqlite3 publishes no bundled binary and compiles from source when its download comes up
# empty; the toolchain serves that fallback alone and stays behind in this stage.
RUN apt-get update && apt-get install --yes --no-install-recommends g++ make python3 && rm -rf /var/lib/apt/lists/*

# fetch works from the lockfile alone, so the dependency download survives source edits; install
# waits for the sources, because postinstall provisions Camoufox from them.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @collegium/app db:generate
RUN pnpm --filter @collegium/app build

# The workspace layout splits node_modules between the root and the package, and neither half is
# complete alone; deploy assembles the app's production tree self-contained. --ignore-scripts
# because the app's own postinstall runs on a devDependency loader; the dependency scripts it also
# skips are re-run by the explicit rebuild, so the schema engine and the native module are baked in
# rather than fetched at container boot.
RUN pnpm --filter @collegium/app deploy --prod --ignore-scripts /deploy
# -C rather than cd: corepack resolves the pnpm version from the invoking directory's package.json,
# and the deployed copy carries no packageManager field
RUN pnpm -C /deploy rebuild better-sqlite3 @prisma/engines prisma

FROM base AS runner

ENV NODE_ENV=production

# the Prisma CLI phones home on every invocation, and the entrypoint runs it at every start
ENV CHECKPOINT_DISABLE=1

# sudo is the whole of the shell tool's privilege (§A2)
RUN apt-get update && apt-get install --yes --no-install-recommends sudo && rm -rf /var/lib/apt/lists/*

# Firefox's shared libraries, resolved by the browser vendor's own matrix rather than a hand-kept list.
COPY --from=build /opt/camoufox /opt/camoufox
COPY --from=build /deploy/node_modules ./node_modules
RUN apt-get update && node node_modules/playwright-core/cli.js install-deps firefox && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/app/package.json /app/app/prisma.config.ts ./
COPY --from=build /app/app/prisma ./prisma
COPY --from=build /app/app/dist ./dist

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch(`http://${process.env.APP_HOST}:${process.env.APP_PORT}/health`).then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "dist/entrypoint.js"]
