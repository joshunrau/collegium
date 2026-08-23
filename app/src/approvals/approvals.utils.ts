import { renderToolDisplayName } from '@collegium/core/tools';

/** the human-facing name of what awaits approval: `ns::tool` for a tool, the bare action otherwise (e.g. extend_budget) */
export function renderApprovalActionName(toolNamespace: null | string, toolName: string): string {
  return toolNamespace === null ? toolName : renderToolDisplayName([toolNamespace, toolName]);
}
