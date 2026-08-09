import { createServer } from 'node:net';
import type { Server } from 'node:net';

/** starts listening and resolves with the bound TCP port; a pre-listen error rejects instead */
export function listenOn(server: Server, options: { host: string; port: number }): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('listening did not yield a TCP address'));
        return;
      }
      resolve(address.port);
    });
  });
}

export async function allocatePort(): Promise<number> {
  const server = createServer();
  const port = await listenOn(server, { host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}
