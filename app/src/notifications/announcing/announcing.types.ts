import type { Result } from '@collegium/core/utils';

import type { ChatFailure } from '@/chat/chat.types.ts';

/** a notice as it landed, with the means to revise it in place under the account that spoke */
export type Announcement = {
  readonly authorUsername: string;
  readonly createdAt: Date;
  edit(text: string): Promise<Result<void, ChatFailure>>;
  readonly postId: string;
};
