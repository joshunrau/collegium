import { describe, expect, it } from 'vitest';

import {
  CORE_TOOLSET_DEFS,
  FRAMEWORK_TOOLSET_DEFS,
  GRANTABLE_TOOLSET_DEFS,
  TOOL_GRANT_VALUES
} from '../toolsets.constants.ts';

describe('framework toolset defs', () => {
  it('should partition every namespace as core or grantable exactly once', () => {
    const names = FRAMEWORK_TOOLSET_DEFS.map((def) => def.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(CORE_TOOLSET_DEFS.length + GRANTABLE_TOOLSET_DEFS.length);
  });

  it('should render each grantable namespace and each of its tools by ref', () => {
    expect(TOOL_GRANT_VALUES).toContain('memory');
    expect(TOOL_GRANT_VALUES).toContain('mail::send');
    expect(TOOL_GRANT_VALUES).not.toContain('skills');
    expect(TOOL_GRANT_VALUES).not.toContain('triggers::resolve');
  });
});
