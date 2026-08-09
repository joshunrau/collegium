import type { ClusterConnection } from './support/cluster.ts';

declare module 'vitest' {
  interface ProvidedContext {
    cluster: ClusterConnection;
  }
}
