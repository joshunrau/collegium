/** How long a single command may run as the dedicated user before `timeout(1)` terminates it (§6.1). */
export const COMMAND_DEADLINE_SECONDS = 60;

/** Grace after the deadline's SIGTERM before `timeout(1)` escalates to SIGKILL. */
export const DEADLINE_KILL_GRACE_SECONDS = 5;

/** GNU `timeout(1)`'s exit status when it had to terminate a command that overran its deadline. */
export const DEADLINE_EXIT_CODE = 124;

/** Longest captured output, per stream, fed back to the model; the rest is dropped with a marker. */
export const OUTPUT_CAP_CHARS = 8_192;

/** Prefix of the dedicated OS user a shell-holding agent runs as (§A2): `collegium-<username>`. */
export const SHELL_OS_USER_PREFIX = 'collegium-';

/** The model-facing name of the shell tool, and the grant marker an agent's `tools` list carries. */
export const SHELL_TOOL_NAME = 'shell';
