## [0.0.1-beta.25](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.24...v0.0.1-beta.25) (2026-09-21)

### Features

- **benchmark:** add the controlled run that measures the framework ([dcf6969](https://github.com/joshunrau/collegium/commit/dcf69697394dbbcf90ef305893619c6c34435ef5))
- **benchmark:** add the noindex fixtures, the large report and the minutes pages ([2373fd5](https://github.com/joshunrau/collegium/commit/2373fd53bada33b1c62f78f1c418065a7e36a354))
- **commands:** lay /collegium inspect out in sections and tables ([27446ff](https://github.com/joshunrau/collegium/commit/27446ffd9cdd5c53fd21f78d20adb2baf67e225d))
- **config:** complete tool grants in an editor writing config.json ([5ec960d](https://github.com/joshunrau/collegium/commit/5ec960d7f36e9cb8b587b93fe14d27bc3107762d))
- **shell:** run under pipefail, add python3, and state the present commands in the preamble ([7ed505c](https://github.com/joshunrau/collegium/commit/7ed505cec3dd1945343eb5da69c508df353c7031))
- **turns:** make the status post deliverable and honest, and give the extension prompt the spend ([2119b12](https://github.com/joshunrau/collegium/commit/2119b12e69bc7e93df1b019fb5699e268ab165dc))
- **turns:** retain page results by token share and name what a collapsed result was ([1b72a4e](https://github.com/joshunrau/collegium/commit/1b72a4e99a2149d2806ef43bc3ad380b338c2d31))
- **turns:** rewrite the prompt to what the framework does and name authors as people or agents ([454727a](https://github.com/joshunrau/collegium/commit/454727aebbbe9c358c9bff80c9c350415b4d998f))
- **web:** let a deployment declare its own network browsable ([9ed3ffc](https://github.com/joshunrau/collegium/commit/9ed3ffc89178eef5cd68db3bbf30a0f0957fb7ea))

### Bug Fixes

- **web:** report a 404 as 404, name browser transport errors, and send a user-agent ([d59ff5c](https://github.com/joshunrau/collegium/commit/d59ff5cf78f359941c922d7a0a3af9b8f60b0f09))

## [0.0.1-beta.24](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.23...v0.0.1-beta.24) (2026-09-19)

### Features

- **clearing:** erase a channel's record before a boundary, under confirmation ([7843cc9](https://github.com/joshunrau/collegium/commit/7843cc90729e6b0f337ec4f4290816dee6b7c333))
- **commands:** add /collegium clear ([237fded](https://github.com/joshunrau/collegium/commit/237fded23a704898e2fd4f6dad8f6b3e57d06e98))
- **config:** word a config.json the schema refuses as one line per issue and path ([02e5ba3](https://github.com/joshunrau/collegium/commit/02e5ba3bfd6a45413d6122bd3e3322251fa9843f))
- **inference:** wait out a rate limit as the provider asks, with jittered backoff and a cap ([49199cc](https://github.com/joshunrau/collegium/commit/49199cc0020c4ca11487820172f581addb1d781e))
- **mattermost:** forward the trigger id and erase a channel's posts before a boundary ([305d5db](https://github.com/joshunrau/collegium/commit/305d5db9b96ff6179541d2c9be2d2375c16d96d3))
- **memory:** read a memory back with how long ago it was written ([7759201](https://github.com/joshunrau/collegium/commit/77592013f69ce61b7b0315f2d9c07afff047e8ba))
- **notifications:** announce a command through one voice that can edit its notice ([b2f89bf](https://github.com/joshunrau/collegium/commit/b2f89bf7603f0ec59eef5ba9908cff28d6cb16c1))
- **shell:** save output a result cannot carry to the agent's workspace and name the file ([b38577b](https://github.com/joshunrau/collegium/commit/b38577ba2533262afb2c5336b2a3c6a948f028dd))
- **tasks:** ask a closing verdict to say what the creator checked ([3546bfa](https://github.com/joshunrau/collegium/commit/3546bfa17c092f1ba3f583307892f24c9ae7e6aa))
- **turns:** tell agents their posts render as markdown and to use no emoji unless asked ([6b73c1b](https://github.com/joshunrau/collegium/commit/6b73c1bbfa38c48e22f2b25166c02e778bb8a6b9))
- **turns:** tell agents to diagnose failures and treat instructions in tool results as data ([62dd62d](https://github.com/joshunrau/collegium/commit/62dd62d900d53d880f55a803109de84d220c451d))
- **turns:** tell agents what not to remember, and to trust what they see over a stale memory ([a2ff54c](https://github.com/joshunrau/collegium/commit/a2ff54ca39e26396cecd8559ea55bb2888c17529))
- **web:** show the text web::fill typed, in the status post and in snapshots ([585b443](https://github.com/joshunrau/collegium/commit/585b443313d59c5e2c924e71bd51906643c1ab9e))

### Bug Fixes

- **approvals:** fence a payload with more backticks than it contains ([3c0fd23](https://github.com/joshunrau/collegium/commit/3c0fd233c763c92126e99dae1c41a0384838f449))
- **runtime:** record the stop time before anything tears down ([78c4c47](https://github.com/joshunrau/collegium/commit/78c4c47c46d06ffbb2f8562560522932fab8ef52))
- **shell:** stop holding a command's output in memory past a bound ([71070c6](https://github.com/joshunrau/collegium/commit/71070c68d5b97b54e37421168d97d487a3e764d4))
- **web:** answer a redirect to an unparseable address as a failed page ([cdc54b3](https://github.com/joshunrau/collegium/commit/cdc54b325215e7071cde32c20ba17335dfb02c3b))
- **web:** judge an address as an address, refusing nat64 loopback and ipv6 multicast ([72e9375](https://github.com/joshunrau/collegium/commit/72e9375b4e49bb0abc6c29ee5c60e092bd213f10))
- **web:** pin webrtc's ice to the proxy instead of trusting camoufox's default ([5f476fb](https://github.com/joshunrau/collegium/commit/5f476fbf767df22c1a51885b4d9e3fb20e250a44))

### Reverts

- remove three beta.23 operator-facing notices ([48410ce](https://github.com/joshunrau/collegium/commit/48410ce9f295cb264a9327587bc4be83171e3c05))

## [0.0.1-beta.23](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.22...v0.0.1-beta.23) (2026-09-18)

### ⚠ BREAKING CHANGES

- **plugins:** a plugin tool compiled without `approval` no longer loads. Add `approval: null`
  to every tool that does not gate.

### Features

- **approvals:** let an agent ask the channel a question and wait for the answer ([ed24e61](https://github.com/joshunrau/collegium/commit/ed24e6176e55482d653c2e62544aea305d32e3ad))
- **approvals:** say which action this is and who asked above every approval payload ([d8a7492](https://github.com/joshunrau/collegium/commit/d8a74929e51384f3427e25b977672bd3a6cd1d81))
- **chat:** parse the files a post carries ([c5c0fb3](https://github.com/joshunrau/collegium/commit/c5c0fb3c910f4edffcc771b3c6a36a33a5373360))
- **chat:** require a shared secret on every callback endpoint ([87ea5f2](https://github.com/joshunrau/collegium/commit/87ea5f20fd2052b1a11f756892a6e7e3145c5b6a))
- **commands:** add /collegium steer ([cf5f018](https://github.com/joshunrau/collegium/commit/cf5f0181e47cdcd7f119f74f402f96252b2921b7))
- **commands:** add /collegium units to list and cancel delegated work ([b149658](https://github.com/joshunrau/collegium/commit/b14965877c7226b03194e90145f3623e7baba33c))
- **commands:** list the approvals still waiting on a human ([ee88049](https://github.com/joshunrau/collegium/commit/ee88049e216a0a65b1341b8372b7007e6d535c10))
- **commands:** mark which of an agent's tools need a human ([e852d5e](https://github.com/joshunrau/collegium/commit/e852d5e5b3fddeba57c4e32f8a2ab6e46d3356f1))
- **config:** let systemPrompt name a file beneath RESOURCES_ROOT ([98c1bc0](https://github.com/joshunrau/collegium/commit/98c1bc0066050d218319d9049eb60604a304f6e6))
- **conversations:** name a post's attached files in the window ([329c1bc](https://github.com/joshunrau/collegium/commit/329c1bc3fe0056f8067c44e1a06d7b11b0c63d50))
- **inference:** classify a length rejection as a context overflow ([b94d409](https://github.com/joshunrau/collegium/commit/b94d409804443decbea663c9f4e2375b4c5de401))
- **inference:** surface a call with unparseable arguments instead of failing the completion ([001a559](https://github.com/joshunrau/collegium/commit/001a5597c827455201de42f9a7a2fe39f7e8e3ff))
- **memory:** evict the least recently used entry rather than the oldest written ([8b2131f](https://github.com/joshunrau/collegium/commit/8b2131ff3256953fd7fca1583fcf68641ddd95b6))
- **memory:** record when an entry's body was last read ([9ac8763](https://github.com/joshunrau/collegium/commit/9ac8763dfaba994acad88d969fa74422cef9d95f))
- **runtime:** verify provider credentials at boot ([258e2d5](https://github.com/joshunrau/collegium/commit/258e2d5e05bf1650fd418bb7bd5f135d6869f667))
- **schedules:** declare recurring work in config and announce it as a trigger ([3d1cb90](https://github.com/joshunrau/collegium/commit/3d1cb90cf0f065be85f486cc1186fcd75f5a59a7))
- **skills:** add the understanding-collegium core skill ([91c0dee](https://github.com/joshunrau/collegium/commit/91c0deee3dfda3387803617946d662d18cf0ac32))
- **skills:** declare the tools a skill needs and refuse an uncovered grant at boot ([e456cd1](https://github.com/joshunrau/collegium/commit/e456cd11fd052e44f0c6d931b295c0672db53adb))
- **skills:** let a skill ship reference documents beside its procedure ([ebd52f9](https://github.com/joshunrau/collegium/commit/ebd52f9db178cf9bd6069cfe95d1b4559ce9eb1e))
- **tasks:** record delegated work as units whose every state change is a post ([e5a99f4](https://github.com/joshunrau/collegium/commit/e5a99f4f2819c96138fcffd20bab77e4207bb820))
- **tools:** let a framework tool return a post the runner publishes ([fe66889](https://github.com/joshunrau/collegium/commit/fe6688922f14195b45e6855479aa6a484d8b1fb1))
- **turns:** bound a turn to one addressed peer across every post it emits ([79b07c5](https://github.com/joshunrau/collegium/commit/79b07c5ea5509210aa78ed40c7de2becb68a7c16))
- **turns:** count a chain by its root and refuse the turn past the limit at admission ([bf834b3](https://github.com/joshunrau/collegium/commit/bf834b32c5489d15cd2496d8956645df69b99109))
- **turns:** forgive one tool call with unparseable arguments per turn ([de6efd9](https://github.com/joshunrau/collegium/commit/de6efd97486beffe62d438ef992c9077af0e7aed))
- **turns:** let a running turn take steering from a human ([a9b9753](https://github.com/joshunrau/collegium/commit/a9b975395af0518225f19b2896d2357a409f5c0e))
- **turns:** list the agent's own earlier actions past the window in the prompt ([50a9f6d](https://github.com/joshunrau/collegium/commit/50a9f6daf3add30a515a78a967ba1b270119eb6a))
- **turns:** name the agent's directories in the preamble ([0035985](https://github.com/joshunrau/collegium/commit/0035985fbd65a158ad44474118ce39e462a32e7e))
- **turns:** record the post every chain descends from on each turn ([78db7dd](https://github.com/joshunrau/collegium/commit/78db7dd044e4d271528311fcfe03b897e4140c3d))
- **turns:** retire stale pages under context pressure and stop when they run out ([032a162](https://github.com/joshunrau/collegium/commit/032a162f496f8a1ccb6d4e0258644128d1cd9a04))
- **turns:** state how long a turn ran on the status post's closing line ([6098426](https://github.com/joshunrau/collegium/commit/60984261c9de3f49c1e29f3c1547f65899abd7a4))
- **workspace:** read the workspace with typed, ungated tools ([9e8fa9e](https://github.com/joshunrau/collegium/commit/9e8fa9e5b1975774ae5032a487b4d5c5e7e1f994))

### Bug Fixes

- **activation:** drop a peer mention the chain limit refused rather than re-queue it ([c6eb387](https://github.com/joshunrau/collegium/commit/c6eb3877e8f09f7f40910c2f576d3416e6d2b120))
- **approvals:** strip peer mentions from a question and an approval payload before posting ([3fbb043](https://github.com/joshunrau/collegium/commit/3fbb043290b6c6eb88f52554bac1ee9534d64449))
- **commands:** report a cancellation that did not post and hint at no approval elsewhere ([a63a3b1](https://github.com/joshunrau/collegium/commit/a63a3b1370a4d29a99ff869315f53575689036a9))
- **memory:** rebuild the memory table so the migration applies to a store with rows ([aff9c3c](https://github.com/joshunrau/collegium/commit/aff9c3c1674e2a9057dc5a167f146604eec757ef))
- **runtime:** close abandoned status posts and measure downtime against the process ([6428618](https://github.com/joshunrau/collegium/commit/6428618c1fba4454ac5eb5e0170c41af874a7593))
- **skills:** refuse a skill directory no name list declares ([ceba454](https://github.com/joshunrau/collegium/commit/ceba4548735c55b35c083566118eaa292d98f8f2))
- **skills:** refuse a skill outside the acting agent's manifest ([6ec1e94](https://github.com/joshunrau/collegium/commit/6ec1e94ebfdb25127611f9e96cd63bdcc6d8567c))
- **turns:** end a turn after two consecutive rejected posts ([0a2935f](https://github.com/joshunrau/collegium/commit/0a2935fbef172767325ce3fe4628e2739c815488))
- **turns:** import the agents module the prompt renderer now needs ([ee5af87](https://github.com/joshunrau/collegium/commit/ee5af8716f7dc8f6229afd3f25ce9e033c12ac57))
- **turns:** keep unread results verbatim and name a colleague that asked ([6518030](https://github.com/joshunrau/collegium/commit/6518030c99a1fd6e8a8920720bf0a4f7f85b4045))
- **turns:** let a tool post mention only the peer it addresses ([05e657d](https://github.com/joshunrau/collegium/commit/05e657d01cea43f7b52e8c3a82514205ddff2ebe))
- **turns:** name the class of a provider rejection by its status code ([5032bc0](https://github.com/joshunrau/collegium/commit/5032bc05b73fc1c2ee0053e61300ec8444dc4219))
- **turns:** reject a leaked tool call written as text ([de44b7b](https://github.com/joshunrau/collegium/commit/de44b7bd135b1502a2fe244d7ffc2d544a8ab240))
- **web:** answer a non-http proxy request with 400 instead of crashing the process ([f192700](https://github.com/joshunrau/collegium/commit/f192700a9622e2fd014a44e4d62118dc8770664c))
- **web:** resolve and pin every address the web tools open ([7df163f](https://github.com/joshunrau/collegium/commit/7df163fdb060f6254dc2f79ad6062265e7b1475d))
- **workspace:** skip symlinks and stop a grep pattern that outruns its budget ([bf0a4a6](https://github.com/joshunrau/collegium/commit/bf0a4a6e6d1599b77a15a061b3c5128c89794d04))

### Refactoring

- **core:** move the token estimate behind one seam ([b2bebe0](https://github.com/joshunrau/collegium/commit/b2bebe0223bcfbb6a8a7b8ccc44d9f6b3a0b5dab))
- **plugins:** require a plugin tool to state whether it gates ([d911941](https://github.com/joshunrau/collegium/commit/d91194138eb666733328f52fa34af9a82e370d09))
- **turns:** render memory writes and deletes as ordinary tool-call lines ([b3d6af7](https://github.com/joshunrau/collegium/commit/b3d6af710e9520f17cfb4e471c9f95f1599f5f83))

## [0.0.1-beta.22](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.20...v0.0.1-beta.22) (2026-09-16)

### Features

- **inference:** stream completions under an idle timeout and take a reasoning effort per model ([2b8961e](https://github.com/joshunrau/collegium/commit/2b8961ef8740ea2db55a3ef9847bdbc4a104c791))
- **models:** offer the openai, anthropic, glm and deepseek models openrouter serves ([273f6df](https://github.com/joshunrau/collegium/commit/273f6df1964456ac1615de55a2a2b7c80d657490))

### Performance

- **conversations:** anchor the window's oldest entry, page the walk, and drop peers' status posts ([7c9f4d2](https://github.com/joshunrau/collegium/commit/7c9f4d2e1b2de358e56cf2183516e62c73ed0fb4))
- **inference:** enable and optimize prompt caching across supported models ([33474e2](https://github.com/joshunrau/collegium/commit/33474e2b6d4b84415262bf1d38dab9dc261f1f5b))
- **turns:** run concurrent reads together, retire stale page results, and coalesce status edits ([f04d2a0](https://github.com/joshunrau/collegium/commit/f04d2a05217b14e2af44cc88a38a14bdb1064004))

## [0.0.1-beta.21](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.20...v0.0.1-beta.21) (2026-09-16)

### Features

- **models:** offer the openai, anthropic, glm and deepseek models openrouter serves ([273f6df](https://github.com/joshunrau/collegium/commit/273f6df1964456ac1615de55a2a2b7c80d657490))

### Performance

- **inference:** enable and optimize prompt caching across supported models ([33474e2](https://github.com/joshunrau/collegium/commit/33474e2b6d4b84415262bf1d38dab9dc261f1f5b))

## [0.0.1-beta.20](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.19...v0.0.1-beta.20) (2026-09-16)

### Features

- **commands:** add queue clear to discard a standing queue entry ([3239b0d](https://github.com/joshunrau/collegium/commit/3239b0d708f36a13c7963fa89db17e6d99974a75))
- **tools:** resolve a granted tool named in its display form ([0de06d9](https://github.com/joshunrau/collegium/commit/0de06d9dbc73d9c5a96f872b4295d28a51c72294))
- **usage:** report what each turn cost in the usage command ([5f4346e](https://github.com/joshunrau/collegium/commit/5f4346ef852a7cec08c871fc8b834a10fabfb797))

### Bug Fixes

- **models:** name openrouter's deepseek models by their provider slugs ([ab6e97e](https://github.com/joshunrau/collegium/commit/ab6e97e48f1940ea502f1125305a3d7d07f20a16))

## [0.0.1-beta.19](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.18...v0.0.1-beta.19) (2026-09-15)

### Bug Fixes

- **tools:** read matched storage rows back in batches under sqlite's bind limit ([6ce696f](https://github.com/joshunrau/collegium/commit/6ce696fb76ab111b48f26142e2fb9553ecf061da))

## [0.0.1-beta.18](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.17...v0.0.1-beta.18) (2026-09-15)

### Features

- **turns:** return mentions to the delegator's depth, cap chain length, and budget per agent ([6811363](https://github.com/joshunrau/collegium/commit/6811363d7add5c79f0858d7f6d464fc6e898083c))

## [0.0.1-beta.17](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.16...v0.0.1-beta.17) (2026-09-15)

### Bug Fixes

- **inference:** name the transport cause in the outage notice and log ([8c39738](https://github.com/joshunrau/collegium/commit/8c3973846908f4b1fe112ed2a0111e1ac2075565))

## [0.0.1-beta.16](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.15...v0.0.1-beta.16) (2026-09-14)

### ⚠ BREAKING CHANGES

- **compose:** MATTERMOST_URL is renamed MATTERMOST_LOCAL_URL, and a deployment running the
  bundled Mattermost must set MATTERMOST_PUBLIC_URL to the exact address it is opened at.

### Features

- **compose:** require the address the bundled mattermost is opened at ([b9604ba](https://github.com/joshunrau/collegium/commit/b9604ba1f9f89316c797e798cfb6670fdc159e84))

## [0.0.1-beta.15](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.14...v0.0.1-beta.15) (2026-09-14)

### Features

- **channels:** hold full membership per channel and answer which channels a search may reach ([36c453d](https://github.com/joshunrau/collegium/commit/36c453da106d9f9cbeedd178c4f5acc8c4f7ae90))
- **chat:** describe channels and deliver membership events for every user ([e9be455](https://github.com/joshunrau/collegium/commit/e9be4551a1d5d0231225aa909e48057ae57c3946))
- **conversations:** add the conversations::search toolset ([17a5690](https://github.com/joshunrau/collegium/commit/17a569065796294fef173e433398af4a09006a52))
- **conversations:** record what kind of post a turn authored and search the agent's own replies ([71a05e8](https://github.com/joshunrau/collegium/commit/71a05e8f318f850779fc5771a89bfc624fb2c6c7))
- **turns:** state what conversations::search reaches in the preamble ([30477a5](https://github.com/joshunrau/collegium/commit/30477a5e947bfe7503bd44618fb0bcf65b356e6c))

### Bug Fixes

- **conversations:** omit the searching agent's own posts from search results ([3dff7a6](https://github.com/joshunrau/collegium/commit/3dff7a64f933cf45d7f438bfb7898f2e5ed1f803))

## [0.0.1-beta.14](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.13...v0.0.1-beta.14) (2026-09-14)

## [0.0.1-beta.13](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.12...v0.0.1-beta.13) (2026-09-13)

### Features

- **commands:** add usage command with cached and reasoning token counts ([0a2558b](https://github.com/joshunrau/collegium/commit/0a2558b696900b332f775c92b00b81e394751934))
- **web:** add web::search backed by brave search ([f184f14](https://github.com/joshunrau/collegium/commit/f184f14c22fd4fe1b4bc0226fabd63285b8d0c04))

## [0.0.1-beta.12](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.11...v0.0.1-beta.12) (2026-09-10)

### Features

- **agents:** add a shared behavioral baseline ([647551f](https://github.com/joshunrau/collegium/commit/647551f88d729aba2e9a0d2aaff91705106cb08b))
- **agents:** add selectable personalities injected into the system prompt ([e3e24fe](https://github.com/joshunrau/collegium/commit/e3e24fe2e6a708f5fdc1ce86bdc2e145f7dc1032))
- **commands:** replace prompt with inspect ([04624c4](https://github.com/joshunrau/collegium/commit/04624c40ed22974b08fd35bd086bb40794c8a7a7))
- **commands:** show a memory body from the channel ([c505718](https://github.com/joshunrau/collegium/commit/c505718272a837a4cdd4a00db09f6931992bd66e))
- **config:** raise default action budget to 25 and hourly ceiling to 500 ([49cdf31](https://github.com/joshunrau/collegium/commit/49cdf319b56820670959998b22a3db1d1d5bc8d5))
- **memory:** let an agent forget one of its memories ([c122325](https://github.com/joshunrau/collegium/commit/c122325070bba9f72661918ff3e5335450a6fbab))
- **turns:** persist reasoning and replay history in native form ([dc2207d](https://github.com/joshunrau/collegium/commit/dc2207d4b5c2bbd8754995d2827c071cb3fcb76c))
- **turns:** replay a tool result by the text the tool names for history ([e422151](https://github.com/joshunrau/collegium/commit/e422151801ed6ddcbc559e6603b2298fbecf1ab5))
- **turns:** state the context limit, resumption, and skill loading in the preamble ([ff05414](https://github.com/joshunrau/collegium/commit/ff05414ad160d438d13b24631cd0f01bd801d65b))
- **web:** add hover and mark the refs CSS hides ([7063d65](https://github.com/joshunrau/collegium/commit/7063d65b4a97c4184db5eee4fc76b9effa5a9ee7))
- **web:** follow a tab the page opens into the session ([565fa7e](https://github.com/joshunrau/collegium/commit/565fa7e8fe87846944c219bdf2f01ffde71aa7ae))
- **web:** report a tab the page opens instead of following it ([6a26165](https://github.com/joshunrau/collegium/commit/6a2616560fcd9aaddff9d51d954e3200a695b854))
- **web:** resolve link and image addresses against the page ([f7a584d](https://github.com/joshunrau/collegium/commit/f7a584da58ea65bc2c8ebcaf7894a2f0624b55a7))

### Bug Fixes

- **activation:** leave the queue standing after a failed exit ([68f49f0](https://github.com/joshunrau/collegium/commit/68f49f041d34f48343b0b51f6c8aeaab78c31893))
- **commands:** import the modules the inspect handler depends on ([b54076f](https://github.com/joshunrau/collegium/commit/b54076f62e4712148d5a87cbb8bed927de623b98))
- **turns:** describe the budget extension flow as the runner performs it ([d92d386](https://github.com/joshunrau/collegium/commit/d92d3864bd9b5ce4896322842de7803d28b6ef6f))

### Refactoring

- **memory:** name the delete tool's vocabulary after delete rather than forget ([973ad5c](https://github.com/joshunrau/collegium/commit/973ad5cea45866fa3cde376d15e813b47a987f9e))
- move system prompt into context.constants.ts ([b15dceb](https://github.com/joshunrau/collegium/commit/b15dceb4c5c117d76db2fc9568938f8b8ddab014))
- **turns:** render the system prompt through a class backed by a text formatter ([0dbba91](https://github.com/joshunrau/collegium/commit/0dbba91b7300324422b5ea951d6da5c4e176e660))

## [0.0.1-beta.11](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.10...v0.0.1-beta.11) (2026-09-09)

### Features

- hold `/collegium` in a Mattermost plugin and declare its subcommands at boot
- accept a post permalink in `/collegium forget` and `/collegium trace`
- add the framework preamble and the `builtins::now` core tool
- read mentions with Mattermost's grammar, replay reasoning within a turn, and reject transcribed tool calls

### Bug Fixes

- give the image the root certificates Go reads

### Refactoring

- derive the command surface from one wire type and read server settings once
- render the preamble from a template constant
