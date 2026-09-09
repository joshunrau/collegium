import type { ClusterConnection } from './support/cluster.ts';
import type { DatabaseTemplate } from './support/database.ts';

declare module 'vitest' {
  interface ProvidedContext {
    cluster: ClusterConnection;
    databaseTemplate: DatabaseTemplate;
  }
}
