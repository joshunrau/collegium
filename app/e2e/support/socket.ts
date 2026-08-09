import { withTimeout } from '@collegium/core/utils';
import { WebSocketClient } from '@mattermost/client';
import { z } from 'zod';

import { $$JSONEncoded } from '@/core/core.schemas.ts';

import { createDeferred } from './utils/deferred.utils.ts';

const SOCKET_CONNECT_TIMEOUT_MS = 15_000;

const $EphemeralMessageEvent = z.object({
  data: z.object({
    post: $$JSONEncoded(
      z.looseObject({
        channel_id: z.string().min(1),
        create_at: z.number(),
        id: z.string(),
        message: z.string(),
        user_id: z.string()
      })
    )
  }),
  event: z.literal('ephemeral_message')
});

/**
 * An interactive dialog never becomes a post — Mattermost pushes it to the invoking client and
 * nowhere else, so the socket is the only way a test can learn the callback id and state it needs
 * in order to submit one.
 */
const $OpenDialogEvent = z.object({
  data: z.object({
    dialog: $$JSONEncoded(
      z.looseObject({
        dialog: z.looseObject({
          callback_id: z.string().default(''),
          elements: z.array(z.looseObject({ name: z.string() })).default([]),
          state: z.string().default(''),
          title: z.string().default('')
        }),
        url: z.string().default('')
      })
    )
  }),
  event: z.literal('open_dialog')
});

declare namespace WorkspaceSocket {
  type Dialog = {
    callbackId: string;
    elementNames: string[];
    state: string;
    title: string;
    url: string;
  };
  type EphemeralPost = {
    channelId: string;
    createdAt: number;
    message: string;
    userId: string;
  };
  type Options = {
    token: string;
    url: string;
  };
}

class WorkspaceSocket {
  private readonly dialogs: WorkspaceSocket.Dialog[] = [];
  private readonly ephemeral: WorkspaceSocket.EphemeralPost[] = [];
  private readonly socket = new WebSocketClient();

  static async connect({ token, url }: WorkspaceSocket.Options): Promise<WorkspaceSocket> {
    const instance = new WorkspaceSocket();
    const connected = createDeferred();

    instance.socket.addFirstConnectListener(() => connected.resolve());
    instance.socket.addMessageListener((event) => instance.record(event));
    instance.socket.initialize(`${url.replace(/^http/, 'ws')}/api/v4/websocket`, token);

    try {
      await withTimeout(connected.promise, SOCKET_CONNECT_TIMEOUT_MS, () => {
        throw new Error(`the workspace socket did not connect to ${url} within ${SOCKET_CONNECT_TIMEOUT_MS}ms`);
      });
    } catch (error) {
      instance.close();
      throw error;
    }

    return instance;
  }

  close(): void {
    this.socket.close();
  }

  describeContents(): string {
    const ephemeral = this.ephemeral.map((post) => `  [ephemeral ${post.channelId}] ${post.message}`);
    const dialogs = this.dialogs.map((dialog) => `  [dialog] ${dialog.title} callbackId=${dialog.callbackId}`);
    const lines = [...ephemeral, ...dialogs];
    return lines.length > 0 ? lines.join('\n') : '  no ephemeral posts or dialogs observed';
  }

  dialogsObserved(): readonly WorkspaceSocket.Dialog[] {
    return this.dialogs;
  }

  ephemeralPosts(): readonly WorkspaceSocket.EphemeralPost[] {
    return this.ephemeral;
  }

  forget(): void {
    this.dialogs.length = 0;
    this.ephemeral.length = 0;
  }

  private record(event: unknown): void {
    const ephemeral = $EphemeralMessageEvent.safeParse(event);
    if (ephemeral.success) {
      const { post } = ephemeral.data.data;
      this.ephemeral.push({
        channelId: post.channel_id,
        createdAt: post.create_at,
        message: post.message,
        userId: post.user_id
      });
      return;
    }
    const dialog = $OpenDialogEvent.safeParse(event);
    if (dialog.success) {
      const { dialog: definition, url } = dialog.data.data.dialog;
      this.dialogs.push({
        callbackId: definition.callback_id,
        elementNames: definition.elements.map((element) => element.name),
        state: definition.state,
        title: definition.title,
        url
      });
    }
  }
}

export { WorkspaceSocket };
