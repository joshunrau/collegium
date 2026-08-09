import { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { LOAD_SKILL_TOOL_NAME } from '@/skills/skills.constants.ts';
import { SkillsService } from '@/skills/skills.service.ts';

type $LoadSkillArgs = z.infer<typeof $LoadSkillArgs>;
const $LoadSkillArgs = z.object({
  name: z.string().min(1).describe('The name of the skill, exactly as it appears in your skill manifest')
});

@Injectable()
export class LoadSkillTool extends Tool({
  description: 'Load the full body of a skill from your skill manifest into the conversation.',
  name: LOAD_SKILL_TOOL_NAME,
  parameters: $LoadSkillArgs,
  timeoutMs: 5000,
  variant: 'ungated'
}) {
  constructor(private readonly skillsService: SkillsService) {
    super();
  }

  execute(args: $LoadSkillArgs): Promise<Tool.Result> {
    const document = this.skillsService.getDocument(args.name);
    if (!document.success) {
      return Promise.resolve(Result.err({ kind: 'invalid-arguments', message: document.error.message }));
    }
    return Promise.resolve(Result.ok({ text: document.value }));
  }

  getApprovalRequirements(): Tool.ApprovalRequirements.Ungated {
    return { kind: 'ungated' };
  }

  isRetryable(): true {
    return true;
  }

  renderTraceDetail(args: $LoadSkillArgs): string {
    return args.name;
  }
}
