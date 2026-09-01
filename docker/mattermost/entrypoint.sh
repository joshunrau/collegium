#!/bin/sh
set -eu

# These three arrive as bind mounts the host created empty and owned by root, and Mattermost writes
# its configuration into one of them on a first boot. Only root can hand them over, so the container
# starts as root and drops to the server's own user here rather than declaring USER in the image.
chown mattermost:mattermost /mattermost/config /mattermost/data /mattermost/logs

exec setpriv --reuid=2000 --regid=2000 --init-groups --inh-caps=-all mattermost "$@"
