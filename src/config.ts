import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const OUTPUT_DIR = path.join(ROOT, 'output');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export type Variant = 'fullstack' | 'frontend' | 'backend' | 'devops' | 'cloud' | 'ai';
export const VARIANTS: Variant[] = ['fullstack', 'frontend', 'backend', 'devops', 'cloud', 'ai'];

export interface Config {
  roles: Record<Exclude<Variant, 'ai'>, string[]>;
  exclude_titles: string[];
  experience_years: number;
  seniority: { title_penalty: string[]; title_bonus: string[] };
  eligible_locations: string[];
  linkedin: { enabled: boolean; queries: string[]; locations: { name: string; geo_id?: string; hours_back: number; pages: number }[]; max_detail_fetches: number };
  hn_whos_hiring: boolean;
  max_job_age_days: number;
  min_score_to_save: number;
  open_max_age_days: number;
  delete_untouched_after_days: number;
  watchlist: { greenhouse: string[]; ashby: string[]; lever: string[] };
  digest: { min_score: number; max_jobs: number; include_unknown_location: boolean; follow_up_after_days: number };
  schedule: { fetch_every_hours: number; digest_at: string };
  cv: { paper: 'A4' | 'Letter' | 'Legal'; max_projects: Record<string, number> };
}

export const config: Config = YAML.parse(fs.readFileSync(path.join(ROOT, 'config.yaml'), 'utf8'));

export const env = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  llmProvider: (process.env.LLM_PROVIDER ?? '').toLowerCase(),
  llmApiKey: process.env.LLM_API_KEY ?? '',
  llmModel: process.env.LLM_MODEL ?? '',
  port: Number(process.env.PORT ?? 3000),
  chromePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
};
