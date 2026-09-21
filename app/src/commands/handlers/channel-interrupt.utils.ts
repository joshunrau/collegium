/** §7.5 — the agents a command reached, named without their @ as every system-bot notice names one (§3.10) */
export function renderAgentNames(agentUsernames: readonly string[]): string {
  return agentUsernames.map((username) => `\`${username}\``).join(', ');
}
