import { renderToolWireName } from '@collegium/core/tools';

/** replayed history is model-facing, so a structural name renders in wire form — never a second spelling (§1) */
export function renderRecordedToolName(name: PrismaJson.RecordedToolName): string {
  return typeof name === 'string' ? name : renderToolWireName(name);
}
