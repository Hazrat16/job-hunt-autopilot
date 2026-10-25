import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { DATA_DIR, type Variant } from './config.ts';
import { detectSkills } from './skills.ts';

export interface Bullet { group?: string; tags: Variant[]; text: string }
export interface Experience {
  company: string;
  role: string;
  location: string;
  start: string;
  end: string;
  sub_roles?: string;
  bullets: Bullet[];
}
export interface ProjectDescription { tags: Variant[]; title: string; text: string }
export interface Project { name: string; url?: string; descriptions: ProjectDescription[] }
export interface SkillLine { label: string; tags: Variant[]; items: string[] }
export type Section = 'ai_practice' | 'experience' | 'skills' | 'projects' | 'education';

export interface Profile {
  basics: { name: string; email: string; phone: string; location: string; links: { label: string; url: string }[] };
  variants: Record<Variant, { title: string; summary: string; sections: Section[] }>;
  ai_practice: string[];
  experience: Experience[];
  projects: Project[];
  skills: SkillLine[];
  education: { school: string; degree: string; dates?: string }[];
  /** Skills mentioned in the profile that you don't want counted as matches. */
  not_claimed?: string[];
}

let cached: { profile: Profile; mtime: number; skills: Set<string> } | undefined;
const FILE = path.join(DATA_DIR, 'profile.yaml');

/** Loads data/profile.yaml, re-reading it whenever the file changes. */
export function loadProfile(): Profile {
  const mtime = fs.statSync(FILE).mtimeMs;
  if (!cached || cached.mtime !== mtime) {
    const profile = YAML.parse(fs.readFileSync(FILE, 'utf8')) as Profile;
    const skills = detectSkills(JSON.stringify({ ...profile, not_claimed: [] }), false);
    for (const s of profile.not_claimed ?? []) skills.delete(s);
    cached = { profile, mtime, skills };
  }
  return cached.profile;
}

/** Every dictionary skill that appears anywhere in your profile. */
export function profileSkills(): Set<string> {
  loadProfile();
  return cached!.skills;
}
