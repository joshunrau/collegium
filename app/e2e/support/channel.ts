import { Client4 } from '@mattermost/client';
import type { Post, PostList } from '@mattermost/types/posts';

import { isSystemPost } from '@/chat/adapters/mattermost.utils.ts';

import { PENDING, waitFor } from './utils/wait.utils.ts';

import type { WorkspaceSocket } from './socket.ts';
import type { AgentBot, WorkspaceChannel } from './workspace.ts';

const CHANNEL_TIMEOUTS = {
  dialog: 10_000,
  ephemeral: 10_000,
  post: 15_000,
  reaction: 10_000,
  update: 15_000
} as const;

const SYSTEM_AUTHOR = 'system';

function toChannelPost(post: Post): Channel.Post {
  return {
    authorId: post.user_id,
    createdAt: post.create_at,
    id: post.id,
    text: post.message,
    updatedAt: post.update_at
  };
}

function toChannelPosts(page: PostList): Channel.Post[] {
  return (
    page.order
      .map((id) => page.posts[id])
      .filter((post) => post !== undefined)
      // an edited post leaves a history row behind, marked by original_id — not a real post
      .filter((post) => post.original_id === '')
      // join/leave notices — the app under test discards these, so assertions must not see them
      .filter((post) => !isSystemPost(post))
      .map(toChannelPost)
      .sort((a, b) => a.createdAt - b.createdAt)
  );
}

declare namespace Channel {
  type Author<AgentName extends string> = AgentName | typeof SYSTEM_AUTHOR;
  type Options<AgentName extends string> = {
    agents: ReadonlyMap<AgentName, AgentBot>;
    channel: WorkspaceChannel;
    client: Client4;
    socket: WorkspaceSocket;
    systemBot: AgentBot;
    teamId: string;
  };
  type Post = {
    authorId: string;
    createdAt: number;
    id: string;
    text: string;
    updatedAt: number;
  };
}

class Channel<AgentName extends string> {
  readonly id: string;
  readonly name: string;

  private readonly agents: ReadonlyMap<AgentName, AgentBot>;
  private readonly client: Client4;
  private readonly socket: WorkspaceSocket;
  private readonly systemBot: AgentBot;
  private readonly teamId: string;
  private watermark = 0;

  constructor({ agents, channel, client, socket, systemBot, teamId }: Channel.Options<AgentName>) {
    this.agents = agents;
    this.client = client;
    this.id = channel.id;
    this.name = channel.name;
    this.socket = socket;
    this.systemBot = systemBot;
    this.teamId = teamId;
  }

  async awaitDialog(options: { timeoutMs?: number; title?: string } = {}): Promise<WorkspaceSocket.Dialog> {
    const { title } = options;
    return waitFor({
      describeFailure: () => this.socket.describeContents(),
      description: title === undefined ? 'an interactive dialog' : `the interactive dialog "${title}"`,
      probe: () =>
        this.socket.dialogsObserved().find((dialog) => title === undefined || dialog.title === title) ?? PENDING,
      timeoutMs: options.timeoutMs ?? CHANNEL_TIMEOUTS.dialog
    });
  }

  async awaitEphemeral(
    options: { contains?: string; timeoutMs?: number } = {}
  ): Promise<WorkspaceSocket.EphemeralPost> {
    const { contains } = options;
    return waitFor({
      describeFailure: () => this.socket.describeContents(),
      description: `an ephemeral post in channel "${this.name}"${contains === undefined ? '' : ` containing "${contains}"`}`,
      probe: () =>
        this.socket
          .ephemeralPosts()
          .find((post) => post.channelId === this.id && (contains === undefined || post.message.includes(contains))) ??
        PENDING,
      timeoutMs: options.timeoutMs ?? CHANNEL_TIMEOUTS.ephemeral
    });
  }

  async awaitPost(options: {
    description: string;
    match: (post: Channel.Post) => boolean;
    timeoutMs?: number;
  }): Promise<Channel.Post> {
    return waitFor({
      describeFailure: () => this.describeContents(),
      description: options.description,
      probe: async () => {
        const posts = await this.postsSinceWatermark();
        return posts.find(options.match) ?? PENDING;
      },
      timeoutMs: options.timeoutMs ?? CHANNEL_TIMEOUTS.post
    });
  }

  async awaitPostFrom(
    author: Channel.Author<AgentName>,
    options: { text?: string; timeoutMs?: number } = {}
  ): Promise<Channel.Post> {
    const bot = this.resolveAuthor(author);
    const expectation = options.text === undefined ? 'a post' : `the post "${options.text}"`;
    return this.awaitPost({
      description: `${expectation} from "${author}" in channel "${this.name}"`,
      match: (post) => post.authorId === bot.userId && (options.text === undefined || post.text === options.text),
      timeoutMs: options.timeoutMs
    });
  }

  /**
   * The status post of §8.1 is edited in place rather than reposted, so a test watches for a
   * revision of a post it already holds rather than for a new one.
   */
  async awaitPostUpdate(
    post: Channel.Post,
    options: { contains?: string; timeoutMs?: number } = {}
  ): Promise<Channel.Post> {
    const { contains } = options;
    return waitFor({
      describeFailure: () => this.describeContents(),
      description: `an edit to post ${post.id}${contains === undefined ? '' : ` containing "${contains}"`}`,
      probe: async () => {
        const current = toChannelPost(await this.client.getPost(post.id));
        if (current.updatedAt <= post.updatedAt) {
          return PENDING;
        }
        return contains === undefined || current.text.includes(contains) ? current : PENDING;
      },
      timeoutMs: options.timeoutMs ?? CHANNEL_TIMEOUTS.update
    });
  }

  async awaitReaction(post: Channel.Post, emojiName: string): Promise<void> {
    // Mattermost answers null, not [], for a post nobody has reacted to
    const reactionsOn = async (postId: string) => (await this.client.getReactionsForPost(postId)) ?? [];
    await waitFor({
      describeFailure: async () => {
        const reactions = await reactionsOn(post.id);
        return `reactions on post ${post.id}: ${reactions.map((reaction) => reaction.emoji_name).join(', ') || 'none'}`;
      },
      description: `a "${emojiName}" reaction on post ${post.id}`,
      probe: async () => {
        const reactions = await reactionsOn(post.id);
        return reactions.some((reaction) => reaction.emoji_name === emojiName) ? true : PENDING;
      },
      timeoutMs: CHANNEL_TIMEOUTS.reaction
    });
  }

  async awaitReplyFrom(agent: AgentName, options: { text?: string; timeoutMs?: number } = {}): Promise<Channel.Post> {
    return this.awaitPostFrom(agent, options);
  }

  async clickAction(post: Channel.Post, actionId: string): Promise<void> {
    await this.client.doPostAction(post.id, actionId);
  }

  /** clicks an approval button as another logged-in user — §3.7's "any human present in the channel" */
  async clickActionAs(client: Client4, post: Channel.Post, actionId: string): Promise<void> {
    await client.doPostAction(post.id, actionId);
  }

  async describeContents(): Promise<string> {
    const posts = await this.postsSinceWatermark();
    const authors = new Map<string, string>([
      ...[...this.agents].map(([name, bot]): [string, string] => [bot.userId, name]),
      [this.systemBot.userId, SYSTEM_AUTHOR]
    ]);
    const rendered =
      posts.length === 0
        ? [`  no posts in channel "${this.name}" since the last message sent by the test`]
        : posts.map((post) => `  [${authors.get(post.authorId) ?? post.authorId}] ${post.text}`);
    return [...rendered, this.socket.describeContents()].join('\n');
  }

  /** emits an ephemeral post to the acting human, so a test can prove the socket observes them */
  async emitEphemeral(message: string): Promise<void> {
    const me = await this.client.getMe();
    await this.client.createPostEphemeral(me.id, { channel_id: this.id, message });
  }

  /** clears observed dialogs and ephemerals, so the next awaitDialog cannot match a stale one */
  forgetInteractions(): void {
    this.socket.forget();
  }

  /** provisions a fresh human, already in this channel, and returns a client logged in as them */
  async joinAsHuman(username: string): Promise<Client4> {
    const { client, userId } = await this.createHuman(username);
    await this.client.addToChannel(userId, this.id);
    return client;
  }

  async mention(agent: AgentName, text: string): Promise<Channel.Post> {
    return this.say(`@${this.resolveAuthor(agent).username} ${text}`);
  }

  async posts(): Promise<Channel.Post[]> {
    return this.postsSinceWatermark();
  }

  /** provisions a human into the team but deliberately not into this channel — §3.7's membership check */
  async provisionHumanOutsideChannel(username: string): Promise<Client4> {
    const { client } = await this.createHuman(username);
    return client;
  }

  async react(post: Channel.Post, emojiName: string): Promise<void> {
    const me = await this.client.getMe();
    await this.client.addReaction(me.id, post.id, emojiName);
  }

  async runCommand(command: string): Promise<void> {
    await this.client.executeCommand(command, { channel_id: this.id, team_id: this.teamId });
  }

  /** issues a slash command as another logged-in user — §7.5's "any human in the channel" */
  async runCommandAs(client: Client4, command: string): Promise<void> {
    await client.executeCommand(command, { channel_id: this.id, team_id: this.teamId });
  }

  async say(text: string): Promise<Channel.Post> {
    const post = toChannelPost(await this.client.createPost({ channel_id: this.id, message: text }));
    this.watermark = post.createdAt;
    return post;
  }

  /** posts under a bot's own identity — how a test speaks as the system bot or a provisioned agent */
  async sayAs(bot: AgentBot, text: string): Promise<Channel.Post> {
    const client = new Client4();
    client.setUrl(this.client.getUrl());
    client.setToken(bot.token);
    return toChannelPost(await client.createPost({ channel_id: this.id, message: text }));
  }

  /** answers a "deny with reason" dialog, which Mattermost forwards to the app rather than posting */
  async submitDialog(dialog: WorkspaceSocket.Dialog, submission: { [field: string]: string }): Promise<void> {
    const me = await this.client.getMe();
    await this.client.submitInteractiveDialog({
      callback_id: dialog.callbackId,
      cancelled: false,
      channel_id: this.id,
      state: dialog.state,
      submission,
      team_id: this.teamId,
      url: dialog.url,
      user_id: me.id
    });
  }

  /** the acting human this channel posts as — whose id a decision must resolve back to (§3.7) */
  async whoAmI(): Promise<{ id: string; username: string }> {
    const me = await this.client.getMe();
    return { id: me.id, username: me.username };
  }

  private async createHuman(username: string): Promise<{ client: Client4; userId: string }> {
    const email = `${username}@example.com`;
    const password = `E2ePass-${username}-1!`;
    const user = await this.client.createUser(
      { email, password, username } as Parameters<Client4['createUser']>[0],
      '',
      ''
    );
    await this.client.addToTeam(this.teamId, user.id);
    const client = new Client4();
    client.setUrl(this.client.getUrl());
    await client.login(username, password);
    return { client, userId: user.id };
  }

  private async postsSinceWatermark(): Promise<Channel.Post[]> {
    return toChannelPosts(await this.client.getPostsSince(this.id, this.watermark));
  }

  private resolveAuthor(author: Channel.Author<AgentName>): AgentBot {
    if (author === SYSTEM_AUTHOR) {
      return this.systemBot;
    }
    const bot = this.agents.get(author);
    if (!bot) {
      throw new Error(`agent "${author}" is not part of this scenario`);
    }
    return bot;
  }
}

export { Channel };
