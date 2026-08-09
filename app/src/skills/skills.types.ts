import type { SKILL_NAMES } from './skills.constants.ts';

export type SkillName = (typeof SKILL_NAMES)[number];

export type { Skill } from '@collegium/core/skills';
