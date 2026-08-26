import { SKILL_NAME_PATTERN } from './skills.constants.ts';

export function assertSkillName(value: string): void {
  if (!SKILL_NAME_PATTERN.test(value)) {
    throw new Error(`skill name "${value}" is not in the dashed skill-name grammar`);
  }
}

/** the qualified name a toolset-shipped skill is granted and loaded by (§9) */
export function renderQualifiedSkillName(namespace: string, skillName: string): string {
  return `${namespace}::${skillName}`;
}
