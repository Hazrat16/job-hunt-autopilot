# Job Automation: Plan

**Goal:** Find remote, worldwide full-stack/DevOps jobs every day, score them against my profile, and give me a tailored CV for each good match in seconds, without editing a CV by hand again.

**Constraints:** Free only (no paid APIs). Notifications via Telegram. My personal LinkedIn account must never be at risk.

---

## 1. How it works (daily flow)

```
 every 6h        ┌──────────────┐   new jobs   ┌──────────┐  score + eligibility  ┌─────────┐
 scheduler ────▶ │ Job sources  │ ───────────▶ │ Dedupe   │ ────────────────────▶ │ SQLite  │
                 └──────────────┘              └──────────┘                       └────┬────┘
                                                                                       │
     9:00 daily: top matches ──▶ Telegram  [📄 CV] [✅ Applied] [🙈 Skip]  ◀──────────┤
                                                                                       │
     anytime:   local dashboard (http://localhost:3000): browse, filter, track, CVs ◀──┘
```

## 2. Features

### Phase 1: Master profile + tailored CV generator (the biggest time saver)
- **`data/profile.yaml`**: one master file merged from all 9 CV versions. Every bullet, project and skill line is tagged (`fullstack`, `frontend`, `backend`, `devops`, `cloud`, `ai`). Alternative phrasings of the same achievement share a `group`.
- **CV variants:** Full-Stack, Frontend, Backend, DevOps, Cloud, and Full-Stack + AI-assisted development. Each has its own title, summary and section order (DevOps puts skills and projects first).
- **Per-job tailoring (no AI needed):**
  1. Detect skills in the job description (about 65-skill dictionary).
  2. Pick the best variant from the job title and description.
  3. Choose the best bullets and project descriptions for that job, and move the skills the job asks for to the front.
  4. Render HTML in the same style as my current CVs, then convert it to PDF with local Chrome. It auto-shrinks to fit one page.
- **Keyword report:** "Matches 14 of 17 skills. Missing: Helm, GCP." This is honest: it only uses facts from the profile and never invents experience.
- **CLI:** `npm run cv -- <jobId>` or `npm run cv -- --file jd.txt`

### Phase 2: Job collection + scoring
| Source | Method | Notes |
|---|---|---|
| RemoteOK, Remotive, Himalayas, Jobicy, We Work Remotely, Arbeitnow | Free public APIs / RSS | All verified working |
| Hacker News "Who is hiring" | Algolia API | Monthly thread, remote posts only |
| Company watchlist | Greenhouse / Ashby / Lever public APIs | GitLab, Canonical, Automattic, Grafana, Vercel, Supabase, PostHog, n8n, Sentry… (editable) |
| LinkedIn jobs | **Logged-out** public job search | Remote + worldwide + last 24h; slow, polite rate; no account used |

- **Dedupe:** the same job on several boards is stored once.
- **Worldwide eligibility check:** 🌍 worldwide / 🌏 Asia-friendly / ❓ unknown / 🚫 restricted ("US only", "must reside in EU", "US work authorization"…). Restricted jobs are never sent.
- **Match score 0–100:** role family match, skill overlap, required years of experience vs mine (see Decisions §3), and eligibility.
- **Title filters** (`config.yaml`): drops sales, PHP, Java, mobile, director and similar titles.

### Phase 3: Telegram bot
- **Daily digest at 9:00:** top matches with score, eligibility, variant, salary, link, and buttons: **📄 CV** (sends the tailored PDF), **✅ Applied**, **🙈 Skip**.
- **Paste-to-CV (my answer for LinkedIn posts from my personal feed):** when I see a "we're hiring" post, I copy or share its text, or a job link, to the bot. It scores the job and replies with a tailored CV. No scraping of my logged-in account, so there's zero ban risk.
- **Commands:** `/top`, `/cv <id>`, `/stats`, `/fetch`
- **Follow-up reminders:** "Applied to X 7 days ago with no update."

### Phase 4: Local dashboard + application tracker
- Job list with filters (score, eligibility, status, source, search)
- Job detail: description, matched and missing skills, live CV preview, variant switcher, PDF download
- **Pipeline:** New → Saved → Applied → Interview → Offer / Rejected / Skipped, with notes and dates
- An "Add job" form, the same as paste-to-CV

### Phase 5 (optional): Free AI helpers
- Provider switch in `.env`: **Gemini free tier**, **Groq free tier**, or **Ollama** (local, fully private)
- Cover letter drafts, a tailored summary paragraph, screening-question answers
- **Guardrail:** AI output is checked against my profile. If it mentions a skill I don't have, it's rejected and the original text is used instead.
- Everything in Phases 1–4 works **without** AI.

### Later ideas
- Analytics: which variant and source gets replies
- Interview prep notes per job
- Recruiter outreach message drafts
- Browser extension: a "Save to tracker" button on any job page

## 3. Tech stack
- **Node 22 + TypeScript**, run directly with no build step (native type stripping)
- **SQLite** via built-in `node:sqlite` (no native modules)
- **cheerio** (HTML/RSS parsing), **yaml**, **express** (dashboard)
- **Local Chrome** in headless mode for PDFs (no extra download)
- One process (`npm start`) runs the scheduler, Telegram bot and dashboard. Can run as a systemd user service.

## 4. Project layout
```
config.yaml            search queries, filters, watchlist, schedule
.env                   Telegram token, optional LLM key
data/profile.yaml      master profile (single source of truth)
data/jobs.db           SQLite
output/cvs/            generated PDFs
src/
  config.ts  util.ts  db.ts  skills.ts  match.ts (eligibility + score)
  sources/   boards.ts  companies.ts  linkedin.ts  manual.ts
  cv/        tailor.ts  render.ts  template.ts
  pipeline.ts  telegram.ts  server.ts  llm.ts  cli.ts  main.ts
```

## 5. Order of work
1. Profile + CV generator → I review 2–3 generated CVs against my originals
2. Sources + scoring → first real run, tune filters and scores
3. Telegram bot + scheduler
4. Dashboard + tracker
5. Optional AI helpers

## 6. Decisions
1. **Dates:** Firmwide May 2026 – Present. SmartCrowd Dec 2022 – Apr 2026.
2. **Repo links:** taken from the hyperlinks inside the existing PDFs (all verified live). The Ansible homelab project has no public link.
3. **Seniority depends on the job post, not the title.** The scorer reads required experience from the description ("5+ years", "3-5 years of experience"). It compares that with my ~3.5 years:
   - Job asks ≤ 4 yrs: fine, even if titled "Senior".
   - Job asks 5 yrs: small penalty.
   - Job asks 6+ yrs: big penalty.
   - Not stated: only obvious titles (Staff, Principal, Head of) get penalized.
4. **Always one page.** A4 by default. The renderer shrinks spacing and font, then drops the lowest-ranked bullets until the CV fits on one page.

## 7. Status
**Phase 1 is done and awaiting review.**
- `data/profile.yaml`: master profile with real repo links, confirmed dates, and `not_claimed: [Azure, GCP]`
- `src/skills.ts` (skill dictionary), `src/match.ts` (variant detection, required-years parsing), `src/cv/tailor.ts`, `src/cv/template.ts`, `src/cv/render.ts`
- `npm run cv -- --url <job link>` or `--file jd.txt`
- One-page guarantee: the fitter measures where Chrome actually prints the last line and recalibrates (Chrome prints about 7% tighter than its screen layout). It shrinks 10.5→9.5pt, then drops the lowest-ranked bullets, and verifies with `pdfinfo`. About 4 seconds per CV.
- Headline uses a fixed list of standard titles (e.g. "Platform Engineer", "React Developer"), never the raw job title. An early test copied "Tech Full-Stack Rails Engineer", which is why.
- Tested on 4 real postings (DevOps, React full-stack, frontend, Rails tech-lead): all single page.

**Written but not tested yet (Phase 2):** source fetchers in `src/sources/` (`boards.ts`, `companies.ts`, `linkedin.ts`, `manual.ts`).

**Note:** the original PDFs are US Legal (8.5×14″). Generated CVs are A4 by default (`cv.paper` in `config.yaml`).
