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
- **Keyword guarantee:** every job skill you have appears on the CV. If its bullet was cut (by selection or by the one-page fitter), your own wording of it is added to an "Additional" skills line and the CV is re-rendered.
- **Core stack line** under the summary: up to 8 matched skills, most-mentioned in the job first.
- **ATS report:** "covers 15 of 16 job keywords (94%). Missing: Microservices (not in your profile)." Measured on the final PDF text.
- Hyphenated words no longer break across lines; project links read "GitHub"/"npm" (no arrows); "Engineering practices" skill line restored.

**Phase 2 is done and awaiting tuning.**
- All 11 sources verified on a live run (2026-10-25): 313 unique jobs in about 45s. 42 worldwide, 6 Asia-friendly, 17 unknown, 248 restricted.
- `src/db.ts`: SQLite (`data/jobs.db`). Dedupe is by company + normalized title, and keeps the longest description across boards.
- `src/eligibility.ts`: description phrases ("must be based in the US", "US work authorization", clearance) beat location fields. A named country, region or timezone means restricted. A city alone means restricted unless the field also says remote. LinkedIn cards name one country, so anything outside Bangladesh is restricted. LinkedIn only fetches descriptions for jobs that aren't restricted.
- `scoreJob` in `src/match.ts`: role 30 + skills up to 50 (match ratio pulled toward 50% when few skills are detected) + eligibility up to 15 + seniority. Missing skills cost 2 each, a missing language 6, a missing language on a requirement line 20, and a missing skill named in the title 25. Restricted jobs are capped at 20.
- CLI: `npm run fetch`, `npm run jobs`, `npm run job -- <id>`, `npm run status -- <id> applied`, `npm run rescore`, `npm run cv -- <id>`.
- Jobs older than `max_job_age_days` (30) are ignored.

**Phase 3 is done and running.**
- Run it with `make dev`: the bot plus the scheduler, restarting when `src/`, `config.yaml` or the profile change. `make start` runs it without restarts, and `make help` lists the other commands.
- `src/telegram.ts`: Bot API over fetch with long polling, so no public URL is needed. The first chat to send `/start` is saved as the owner (or set `TELEGRAM_CHAT_ID`), and every other chat is ignored.
- Daily digest: unsent jobs with `min_score` or higher that aren't restricted, one card each with 📄 CV / ✅ Applied / 🙈 Skip buttons. Follow-up reminders `follow_up_after_days` after you mark a job Applied.
- Paste-to-CV: any text or job link sent to the bot is scored, stored as a manual job, and answered with a tailored CV.
- Commands: `/top`, `/job <id>` (tappable as `/job_86`), `/cv <id>`, `/fetch`, `/digest`, `/stats`.
- `src/main.ts`: checks the schedule every minute against times saved in the database, so sleep or a restart catches up instead of skipping. CV renders run one at a time.

**Phase 4 is done.** The dashboard is at http://localhost:3000 whenever `make dev` is running. It listens on 127.0.0.1 only.
- `src/server.ts`: an Express JSON API (`/api/jobs`, `/api/jobs/:id`, PATCH status/notes, POST add job, `/cv/preview`, `/cv.pdf`, `/api/fetch`, `/api/meta`).
- `src/web/`: plain HTML/CSS/JS with no build step. Light and dark themes, works at phone width.
- Jobs view: search plus filters for score, eligibility, status, source and posting age; ↑/↓ or j/k to move through the list; `#job=<id>` deep links.
- Detail view: score and eligibility reason, skills matched/missing, status buttons with a dated history (`job_events`), notes that save when you leave the box, the job description, and a CV variant switcher.
- CV: an instant preview (the fit-to-one-page script runs in your browser) and a Chrome-rendered PDF download with the ATS coverage line. Renders are shared one at a time with the bot.
- Pipeline view: Saved / Applied / Interview / Offer / Rejected / Skipped columns. Drag cards to change status, click a card to open it.
- Add job: paste text or a link, the same as the bot's paste-to-CV.
- CVs are only made on request: **Create tailored CV** on the dashboard, or **📄 CV** on a bot card. Opening a job or pasting one into the bot never builds a CV by itself.
- Friendlier UI: quick views (Best matches, All open, Saved, Everything) with the detailed filters folded away, actions that follow your progress (Save / I applied / Not for me → Got an interview → Got an offer), plain-language score and location labels, "NEW since your last visit" badges, and a folded description.

**Apply-by-email drafts:** `src/apply-email.ts` finds posts that ask for applications by email ("Send your CV to…", "To apply, email…", or a `mailto:` apply link). It reads the sentence around each address and skips accommodation, fraud-report and "questions" addresses: 12 of 387 stored jobs matched, with no false positives. It picks up a requested subject (filling templates like "your name, your city"), a reference code, a contact name to greet, and what they ask you to include. The draft uses only profile facts: your CV headline, years, the matched core stack, your two best-matching bullets (from different employers when possible), a related project link, `basics.availability`, and your signature. Shown as an editable card on the dashboard (with Gmail, mail-app and copy buttons), a ✉️ Email button on bot cards, a ✉ tag in the job list, and a line in `npm run job`.

**LinkedIn search (2026-10-25):** 12 queries, each run in two locations. "Worldwide" (24h, 2 pages) mostly returns remote-within-one-country jobs. "Bangladesh" (7 days, 1 page) returns remote jobs you're eligible for: 11 eligible matches on the first run, compared with about 1 before. Descriptions are only downloaded for jobs that aren't restricted and don't already have one. A 429 stops the run politely. View the results with `make jobs SOURCE=linkedin`.

**Note:** the original PDFs are US Legal (8.5×14″). Generated CVs are A4 by default (`cv.paper` in `config.yaml`).
