import { expectTypeOf, test } from 'vitest';

import { Tool } from '../tools.definition.ts';

test('Tool.ApprovalRequirements', () => {
  expectTypeOf<Tool.ApprovalRequirements>().toEqualTypeOf<
    Tool.ApprovalRequirements.Gated | Tool.ApprovalRequirements.Ungated
  >();
  expectTypeOf<Tool.ApprovalRequirements<'dynamic'>>().toEqualTypeOf<Tool.ApprovalRequirements>();
  expectTypeOf<Tool.ApprovalRequirements<'gated'>>().toEqualTypeOf<Tool.ApprovalRequirements.Gated>();
  expectTypeOf<Tool.ApprovalRequirements<'ungated'>>().toEqualTypeOf<Tool.ApprovalRequirements.Ungated>();
});
