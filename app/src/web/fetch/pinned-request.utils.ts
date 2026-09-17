import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import type { VettedAddress } from '../web.types.ts';
import type { PinnedResponse } from './fetch.types.ts';

/** the body as the server meant it to be read: no encoding was asked for, but some servers compress regardless */
function decodedBody(response: IncomingMessage): Readable {
  switch (response.headers['content-encoding']) {
    case 'br':
      return response.pipe(createBrotliDecompress());
    case 'deflate':
      return response.pipe(createInflate());
    case 'gzip':
      return response.pipe(createGunzip());
    default:
      return response;
  }
}

function toHeaders(response: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (value !== undefined && name !== 'content-encoding') {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
  }
  return headers;
}

/**
 * A resolver that answers with the address already judged, whatever the name: the socket connects
 * there while the request still carries the URL's own hostname, which Node derives the Host header
 * and the TLS name from. This is the whole seam that makes a connection pinned (§3.4).
 */
export function pinnedLookup(vetted: VettedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: vetted.address, family: vetted.family }]);
    } else {
      callback(null, vetted.address, vetted.family);
    }
  };
}

/** one GET over a pinned connection; redirects are not followed, since the caller judges each hop */
export function pinnedGet(
  url: string,
  vetted: VettedAddress,
  init: { readonly accept: string; readonly signal: AbortSignal }
): Promise<PinnedResponse> {
  const request = new URL(url).protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      { headers: { accept: init.accept }, lookup: pinnedLookup(vetted), signal: init.signal },
      (response) => {
        resolve({ body: decodedBody(response), headers: toHeaders(response), status: response.statusCode ?? 0 });
      }
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}
