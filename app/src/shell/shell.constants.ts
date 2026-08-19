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

/**
 * Where derived OS user ids start: above the system range (ends at 999), above the accounts the
 * image itself holds, and above `nobody` (65534), so a derived id never lands on one that already
 * means something.
 */
export const SHELL_OS_USER_ID_BASE = 100_000;

/**
 * How many ids the range spans — wide enough that two agent usernames deriving one id is a boot
 * refusal nobody meets in practice, and far below where 32-bit id handling gets delicate.
 */
export const SHELL_OS_USER_ID_COUNT = 900_000;

/**
 * Where `sudo` is launched from. The child inherits it, and the app's own working directory is
 * deliberately untraversable to agent users (§6.1) — a shell starting somewhere it cannot stat
 * prints a `getcwd` warning onto the model's stderr before it can reach the agent's home.
 */
export const SPAWN_WORKING_DIRECTORY = '/';

/** The model-facing name of the shell tool, and the grant marker an agent's `tools` list carries. */
export const SHELL_TOOL_NAME = 'shell';
