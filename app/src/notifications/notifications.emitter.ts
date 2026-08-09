import type { SystemEvent } from './notifications.types.ts';

export abstract class NotificationsEmitter {
  abstract notify(event: SystemEvent): Promise<void>;
}
