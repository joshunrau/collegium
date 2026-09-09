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

/** the inverse of renderQualifiedSkillName: a framework skill has no namespace */
export function parseQualifiedSkillName(qualifiedName: string): { namespace: string | undefined; skillName: string } {
  const separator = qualifiedName.indexOf('::');
  if (separator === -1) {
    return { namespace: undefined, skillName: qualifiedName };
  }
  return { namespace: qualifiedName.slice(0, separator), skillName: qualifiedName.slice(separator + 2) };
}
