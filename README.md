# AEO standing

Measure how a company shows up in AI answer engines, reading by reading.

When a buyer asks ChatGPT, Perplexity, Gemini or Claude about your market, do
you come up? Are you recommended, compared, or named as the one to avoid? Who
comes up more often than you? This tool asks the same buyer questions of every
assistant on a fixed cadence, stores every answer, scores them, and shows where
you stand and how that moves.

It is a self-hosted web app: one Node process, a SQLite file, and a browser
UI. You need API keys for the assistants you want measured and one model to act
as the judge.

- **Answer engines measured:** ChatGPT (OpenAI Responses API with web search),
  Perplexity (Sonar), Gemini (Google Search grounding), Claude (web search).
  Each is optional; set the keys you have.
- **Judge:** Claude or Gemini, whichever key is present. It writes the initial
  question panel from your website and reads each answer to say how every brand
  was treated.

---

## What "standing" is, and how it is calculated

### 1. The panel: the questions you are measured on

A company is measured on a **panel** of about 20 buyer questions, written by the
judge from the company's website. They are the questions a real buyer in your
market would type into an assistant while deciding what to buy, and they never
name you or any vendor: a question that names a brand always surfaces that
brand, so it measures the brand's name rather than its standing.

The questions are spread across four kinds, because different kinds of question
are won by different kinds of content:

| Kind | What the buyer is doing | Example shape |
|---|---|---|
| discovery | finding options at all | "best X for Y" |
| comparison | weighing options against each other | "X vs Z", phrased generically |
| validation | checking something out | "is X worth it", "what do people think of X" |
| implementation | working out how to do it | "how do I set up X" |

A validator rejects branded questions, keyword strings, and duplicates, and
trims the panel round-robin across the four kinds so no kind is cut.

You can edit the questions. **Every edit is a new version, never a change in
place.** Every stored reading points at the panel version it was asked on, so a
trend drawn across an edit would otherwise compare two different question sets
as if they were one. The chart draws a wall where the version changed.

### 2. A reading: ask everything, keep everything

A **reading** asks every question of every configured engine, `repeats` times
(default 1). With 20 questions and three engines that is 60 answers. The full
answer text and the raw vendor payload are stored before anything is scored, so
scoring rules can change without re-asking, and re-paying, the engines.

Readings run automatically every 10 days (configurable), and the first one runs
shortly after you add a company. You can also take one by hand. Two readings can
never run at once on the same company; a second click is refused, because it
would ask every engine the same questions again and bill for both.

### 3. Scoring: two passes

**The rule-based pass** looks only for the company, and it is the source of
truth for whether the company was there:

- **Named**: the company's name (or one of its aliases) appears in the prose of
  the answer. Matching is word-boundary anchored and case-insensitive, so a
  company called "Wise" is not found inside "otherwise". URLs are stripped
  first, so a bare link to your site is a citation, not a mention.
- **Cited**: a URL on the company's domain is among the sources the answer
  attributes. URLs are canonicalised (tracking parameters removed, `www`
  dropped) before comparing.
- **Retrieved**: a URL on the domain was fetched during the engine's research,
  whether or not the answer used it. Only some engines report this layer.

**The judge pass** reads each answer once and reports, for the company **and
every competitor you declared**, whether it was mentioned, its **position**
(first brand named is 1), its **sentiment**, and its **context**:

| Context | Meaning |
|---|---|
| recommended | put forward as a choice worth making |
| compared | weighed against an alternative |
| dismissed | named as the worse or wrong option |
| passing | mentioned with no stance either way |

This pass is what creates competitor rows at all. It is on by default and can
be switched off, in which case there is no leaderboard and no share of voice.

### 4. The numbers

Every rate is `hits / n` over the answers that actually came back in the latest
completed reading. **Failed answers are excluded from every denominator**: a
vendor outage is not evidence that you were absent. Every rate carries its `n`
and a 95% Wilson interval, because 80% of 5 answers and 80% of 400 are the same
number and not the same claim.

| Number | Definition |
|---|---|
| **Mentioned** | answers naming the company / answers |
| **Cited** | answers with a source on the company's domain / answers |
| **Share of voice** | company mentions / (company mentions + declared-competitor mentions). `null` when no competitor was recorded, never 100% |
| **Questions covered** | questions where the company appeared in at least one answer / questions. Rises with `repeats` for the same underlying performance, so compare it only at the same repeat count |
| **Retrieved**, **Selection** (API only) | answers that fetched the site / answers; and of those, the share that cited it. Low citation with high selection is an indexing problem, low selection is a content problem |
| **By assistant** | mention-or-cite rate per engine. Never averaged across engines, because they do not share an index |
| **By question kind** | the same, per intent |

**The leaderboard** ranks the company and its declared competitors by the number
of **distinct questions** each was mentioned in, then by total mentions. A brand
named five times in one answer has not out-reached a brand named once in three
different questions, so questions are the comparable unit. The company's
**rank** is its position in that list, and it is `null`, not last place, when it
was never mentioned. The **tone split** shows how many of the company's mentions
were recommended, compared, dismissed, or in passing.

**The trend** carries one point per reading: the share of panel questions the
company was named in, with its rank, the number of brands on the board, and the
panel version. A reading where nobody named the company is a real, bad reading
and sits on the floor as a hollow dot; a reading whose panel size is unknown
cannot be placed and breaks the line.

### 5. Rules the numbers obey

- **A rate with no denominator is `null`, never `0`.** "Not measured" and
  "measured and found nothing" are opposite facts, and the UI prints
  *not measured yet* rather than a number it does not have.
- **No lift, no baseline.** A company was visible in AI answers before you
  started measuring and will be after you stop, so there is nothing to subtract.
  What you get is a series of positions, not a claim about cause.
- **Competitors are the denominator.** Change the list and share of voice is not
  comparable across the edit. The UI says so when you save.
- **Caveats render above the numbers**, not beneath them: thin readings, a
  single reading, a panel version change, a reading in progress.
- **Engines are never averaged.** What ChatGPT cites and what Perplexity cites
  overlap far less than people assume.

### 6. What this is not

- Not traffic, clicks or conversions. It measures what the assistant says.
- Not real users. These are our questions on a schedule, through the vendors'
  APIs, which are stable, repeatable proxies for the consumer products rather
  than the products themselves. The consumer ChatGPT personalises before it
  retrieves.
- Only the competitors you declared. Miss one and it is silently absent.
- Google AI Overviews, Copilot and Grok are absent rather than stubbed: a stub
  that returns nothing is indistinguishable from an engine that found nothing.

---

## Quick start

Requires Node 22 or newer.

```bash
git clone https://github.com/Astute-Org/aeo-reporting.git
cd aeo-reporting
cp .env.example .env    # add the keys you have
npm install
npm run dev             # UI at http://localhost:5180, API at http://localhost:3400
```

Add a company: name, website, aliases, competitors. The judge writes the
questions from the website (about a minute), the first reading starts on the
next scheduler tick, and the report fills in as answers land.

### Running it for real

```bash
npm run build
npm start               # one process on http://localhost:3400
```

Or with Docker, which keeps the database in a named volume:

```bash
docker compose up -d
```

**Set `ADMIN_PASSWORD` before exposing it to the internet.** Every click spends
API money, and the database holds your declared competitor list. With the
password set, the browser asks for it (any username).

## Configuration

All settings are environment variables, read from `.env` in the repository root
or from the process environment. Every key is optional.

| Variable | Default | What it does |
|---|---|---|
| `OPENAI_API_KEY` | | Measures ChatGPT. `AEO_OPENAI_MODEL` (default `gpt-4.1`) |
| `PERPLEXITY_API_KEY` | | Measures Perplexity. `AEO_PERPLEXITY_MODEL` (default `sonar`) |
| `GEMINI_API_KEY` | | Measures Gemini. Or `GEMINI_AUTH_MODE=vertex` with `VERTEX_PROJECT_ID` and application-default credentials. `AEO_GEMINI_MODEL` (default `gemini-3.5-flash`) |
| `ANTHROPIC_API_KEY` | | Measures Claude. `AEO_ANTHROPIC_MODEL` (default `claude-opus-5`) |
| `AEO_ENGINES` | all configured | Comma-separated allow-list, e.g. `openai,perplexity`. Worth setting on a first run |
| `AEO_JUDGE_PROVIDER` | `auto` | `anthropic` or `gemini`. Auto picks Anthropic when its key is set, else Gemini |
| `AEO_JUDGE_MODEL` | `claude-opus-5` / `gemini-3.5-flash` | The model that reads answers |
| `AEO_PANEL_MODEL` | same as judge | The model that writes the question panel |
| `AEO_LLM_SCORING` | `true` | Set `false` to skip the judge pass (no competitors, no leaderboard) |
| `FIRECRAWL_API_KEY` | | Better page text for question writing on JavaScript-heavy sites |
| `PORT` | `3400` | The port to listen on. `AEO_PORT` wins when both are set |
| `ADMIN_PASSWORD` | | HTTP basic auth over the whole app |
| `AEO_DATA_DIR` | `./data` | Where `aeo.sqlite` lives |
| `AEO_SCHEDULER_ENABLED` | `true` | Automatic readings on each company's cadence |
| `AEO_DISPATCH_INTERVAL_MS` | `900000` | How often the scheduler looks for due readings (15 min) |
| `AEO_COMPANY_CADENCE_HOURS` | `240` | Days between readings, for new companies (10 days) |
| `AEO_CONCURRENCY` | `4` | In-flight engine calls per reading. Higher trips rate limits |
| `AEO_STALE_RUN_MINUTES` | `360` | A reading still running after this long is closed out as failed |

### Cost

Measured from real usage, per answer: OpenAI about $0.05 (the hosted search
puts a lot of page content into every call), Gemini about $0.01, Perplexity
about $0.006, Claude about $0.15. The judge pass adds a short call per answer.
Twenty questions on three engines is roughly $1.50 a reading, three readings a
month. The UI states the estimate before every manual reading.

## The API

Everything the UI does goes through `/api`. Useful if you want the numbers
somewhere else.

| Method and path | What it does |
|---|---|
| `GET /api/status` | Configured engines, judge, scheduler |
| `GET /api/companies` | Every company with its latest reading date |
| `POST /api/companies` | `{ name, url?, aliases?, competitors?, notes? }`. Writes the panel |
| `GET /api/companies/:id` | Company, active panel, questions |
| `PATCH /api/companies/:id` | `{ competitors?, aliases?, notes? }` |
| `DELETE /api/companies/:id` | Deletes every reading too |
| `PUT /api/companies/:id/panel` | `{ prompts: [{ text, intent }] }`. Saves as a new version |
| `POST /api/companies/:id/panel/generate` | Rewrites the panel from the website, as a new version |
| `POST /api/companies/:id/runs` | Takes a reading now. 409 if one is running |
| `GET /api/companies/:id/report` | The report: latest metrics, leaderboard, trend, caveats |
| `GET /api/companies/:id/prompts` | Each question with its hit counts on the latest reading |
| `GET /api/companies/:id/answers?promptId=` | What every assistant answered to one question |

## Development

```bash
npm test          # server (pure scoring, metrics, SQL against an in-memory DB) and client (rendered components)
npm run typecheck
```

Layout:

```
server/src
  engines/          one adapter per answer engine, plus the registry
  llm/              the judge (Anthropic or Gemini) and the clients
  citation-match.ts URL canonicalisation and brand matching - the rules every number rests on
  score-answer.ts   rule-based pass: engine answer -> observation rows
  score-answer-llm.ts   judge pass: position, sentiment, context, competitors
  metrics.ts        rates with Wilson intervals; null when there is no denominator
  standing.ts       the leaderboard
  company-report.ts the report and the trend
  generate-panel.ts writing and validating the question panel
  run-panel.ts      one reading, end to end
  scheduler.ts      claims due panels and reclaims abandoned readings
  routes.ts         the API
client/src
  aeo/              the report screens; CompanyView.tsx is pure rendering and is what the tests cover
```

## License

MIT.
