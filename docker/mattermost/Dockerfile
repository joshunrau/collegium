# syntax=docker/dockerfile:1

FROM alpine:3.22 AS download

ARG MATTERMOST_VERSION=11.7.7
ARG TARGETARCH

RUN wget -qO- "https://releases.mattermost.com/${MATTERMOST_VERSION}/mattermost-${MATTERMOST_VERSION}-linux-${TARGETARCH}.tar.gz" | tar -xz

FROM debian:bookworm-slim

# curl serves the compose healthcheck, which gates the app's start on a Mattermost that answers
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 2000 mattermost
RUN useradd -u 2000 -g mattermost -d /mattermost -s /usr/sbin/nologin mattermost

COPY --from=download --chown=mattermost:mattermost /mattermost /mattermost

RUN install -d -o mattermost -g mattermost /mattermost/config /mattermost/data /mattermost/logs

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

WORKDIR /mattermost

ENV PATH="/mattermost/bin:${PATH}"

EXPOSE 8065

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]