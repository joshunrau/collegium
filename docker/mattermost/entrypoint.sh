#!/bin/sh
set -eu

# a Site URL other than the address people open Mattermost at refuses the browser's websocket, and
# nothing reports it: pages load, and new posts appear only after a reload
if [ -z "${MM_SERVICESETTINGS_SITEURL:-}" ]; then
  echo "MM_SERVICESETTINGS_SITEURL is empty: set MATTERMOST_PUBLIC_URL in .env to the exact address you open Mattermost at, e.g. http://localhost:8065" >&2
  exit 1
fi

# These three arrive as bind mounts the host created empty and owned by root, and Mattermost writes
# its configuration into one of them on a first boot. Only root can hand them over, so the container
# starts as root and drops to the server's own user here rather than declaring USER in the image.
chown mattermost:mattermost /mattermost/config /mattermost/data /mattermost/logs

exec setpriv --reuid=2000 --regid=2000 --init-groups --inh-caps=-all mattermost "$@"
