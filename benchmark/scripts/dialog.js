/// <reference types="node" />

// @ts-check

/**
 * Presses a prompt button that opens an interactive dialog and submits the dialog with one text
 * field: the approval prompt's "Deny with reason" (action `reason`, field `reason`) and the ask
 * prompt's free-text answer (action `answer`, field `answer`). Mattermost pushes a dialog only over
 * the websocket of the user who pressed the button, and its state is signed per prompt, so plain
 * REST cannot do this step; every other button is a plain POST /api/v4/posts/{id}/actions/{action}.
 *
 *   node benchmark/scripts/dialog.js --url http://127.0.0.1:8066 --token <session token> \
 *     --post <prompt post id> --action reason --field reason --text "Use summary.txt instead."
 */

import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    action: { type: 'string' },
    field: { type: 'string' },
    post: { type: 'string' },
    text: { type: 'string' },
    token: { type: 'string' },
    url: { type: 'string' }
  }
});
const { action, field, post, text, token, url } = values;
if (!action || !field || !post || text === undefined || !token || !url) {
  console.error(
    'usage: dialog.js --url <mattermost> --token <token> --post <id> --action <id> --field <name> --text <text>'
  );
  process.exit(1);
}

const DIALOG_TIMEOUT_MS = 15_000;
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

/**
 * @param {string} route
 * @param {unknown} body
 */
async function postJson(route, body) {
  const response = await fetch(`${url}${route}`, { body: JSON.stringify(body), headers, method: 'POST' });
  if (!response.ok) {
    throw new Error(`${route} answered ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const me = await (await fetch(`${url}/api/v4/users/me`, { headers })).json();
const postRecord = await (await fetch(`${url}/api/v4/posts/${post}`, { headers })).json();
const channel = await (await fetch(`${url}/api/v4/channels/${postRecord.channel_id}`, { headers })).json();

const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/api/v4/websocket`);
const dialog = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('no dialog arrived within the timeout')), DIALOG_TIMEOUT_MS);
  socket.addEventListener('message', (message) => {
    const event = JSON.parse(String(message.data));
    if (event.event !== 'open_dialog') {
      return;
    }
    clearTimeout(timer);
    resolve(JSON.parse(event.data.dialog));
  });
  socket.addEventListener('error', (event) => reject(new Error(`websocket error: ${String(event)}`)));
});
await new Promise((resolve) => socket.addEventListener('open', resolve));
socket.send(JSON.stringify({ action: 'authentication_challenge', data: { token }, seq: 1 }));

await postJson(`/api/v4/posts/${post}/actions/${action}`, {});
const opened = await dialog;
await postJson('/api/v4/actions/dialogs/submit', {
  callback_id: opened.dialog.callback_id,
  cancelled: false,
  channel_id: postRecord.channel_id,
  state: opened.dialog.state,
  submission: { [field]: text },
  team_id: channel.team_id,
  url: opened.url,
  user_id: me.id
});
socket.close();
process.stdout.write(`${`submitted ${field} for ${action} on ${post}`}\n`);
