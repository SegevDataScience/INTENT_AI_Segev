# Simulation: a local demo site for Intent AI

> **Note (2026-11-06):** after the repo restructure, the folder moved from `simulation/` to `presentation/simulation/`. The paths below reflect the state at the time of writing.

**Date:** 2026-11-06
**Status:** Awaiting approval
**Location in the repo:** `simulation/` (at the root of `Intetnt-ai-v1`)

## 1. Goal

A site that runs locally on the developer's machine and demonstrates the core product value: an end user on a real Israeli site sends feedback by **voice** or **text**, and the feedback is saved in the **TEST DB** under the right customer. The company then sees it in a per-customer dashboard.

**Audience:** live demos (customers and investors) from the local machine. This is not production and not deployed.

**Success criteria:**
1. `npm install && npm start` inside `simulation/` brings up the site at `http://localhost:4000` with no Docker, pnpm or paid keys.
2. On the Shufersal page, text feedback and voice feedback (with a Hebrew transcript when the browser supports it) can be sent.
3. Each submission is saved as a row in `simulation/data/test.db`, linked to the right customer and product. Voice recordings are saved as files.
4. The dashboard shows the feedback filtered by customer, including playable audio, sentiment and category.
5. The automated tests (`npm test`) pass.

## 2. Decisions made

| Topic | Decision | Reason |
|---|---|---|
| DB | SQLite through the built-in `node:sqlite` module (Node 24) | Cheapest and simplest: zero installs, a single file, easy to reset. Docker isn't running on the machine. |
| Real sites | A full screenshot of the real site, taken with headless Edge, with the widget floating on top | Real sites block iframes. A screenshot always works, even offline. |
| Customers | Shufersal only, configured in `sites.json`. Adding a site = one line + running capture | What the user chose |
| Transcription | Web Speech API in the browser (`he-IL`), free | No Whisper cost |
| Analysis | A local heuristic based on Hebrew keywords (sentiment + category) | Free, deterministic, testable |
| Server | Node + Express (the only dependency) | Simple, consistent with `apps/api` |
| Monorepo | `simulation/` is standalone and not part of the pnpm workspace | Doesn't touch existing code and doesn't need pnpm |

**Out of scope (YAGNI):** user login, paid AI (Claude/Whisper), session replay, frustration detection, Jira/Slack integrations, deployment.

## 3. Structure

```
simulation/
  package.json        scripts: start, test, capture, reset
  server.js           creates the Express app and listens on PORT (default 4000)
  src/
    app.js            createApp(db) → Express app (separated from listening, for tests)
    db.js             openDb(path) + schema + query functions
    analyze.js        analyze(text) → { sentiment, category }
    seed.js           loads sites.json into the DB (idempotent)
  sites.json          [{ slug, name, url, industry, apiKey }]
  scripts/
    capture.js        screenshots each site → public/sites/<slug>.png
    reset.js          deletes test.db and the audio files, then runs seed again
  public/
    index.html        site picker for the demo
    site.html         ?s=<slug>: the screenshot + the widget
    widget.js         the widget (vanilla JS, no build step)
    widget.css
    dashboard.html    feedback per customer
    sites/            screenshots (in .gitignore)
  data/               test.db + audio/ (in .gitignore)
  test/
    db.test.js
    analyze.test.js
    api.test.js
```

Each unit has a single responsibility:
- `db.js` is the only place that knows SQL.
- `analyze.js` is a pure function.
- `app.js` receives a db from outside, so tests can pass a temporary DB.

## 4. DB schema (TEST)

A simplified mirror of the product's Prisma models (`Organization`, `Product`, `EndUser`, `Feedback`):

```sql
organizations (id TEXT PK, slug TEXT UNIQUE, name TEXT, industry TEXT, created_at TEXT)
products      (id TEXT PK, organization_id TEXT FK, name TEXT, url TEXT, api_key TEXT UNIQUE, created_at TEXT)
end_users     (id TEXT PK, product_id TEXT FK, external_id TEXT, first_seen TEXT, last_seen TEXT,
               UNIQUE(product_id, external_id))
feedback      (id TEXT PK, product_id TEXT FK, end_user_id TEXT FK,
               type TEXT CHECK(type IN ('text','voice')),
               content TEXT,          -- the text, or the transcript for voice
               audio_path TEXT,       -- relative to data/audio, voice only
               audio_duration_ms INTEGER,
               rating INTEGER,        -- 1-5, optional
               sentiment TEXT,        -- positive / neutral / negative
               category TEXT,         -- checkout / delivery / prices / site / service / other
               page_url TEXT,
               created_at TEXT)
```

IDs are generated with `crypto.randomUUID()`, and dates are ISO strings.

## 5. API

The widget authenticates with `X-API-Key` (the product's key), the same way as in the real product.

| Method | Path | Description |
|---|---|---|
| GET | `/api/sites` | List of customers and products (for the picker and the dashboard). Doesn't return keys. |
| GET | `/api/sites/:slug/widget-config` | The product key for the demo page (local demo only) |
| POST | `/api/feedback` | Header `X-API-Key`. JSON body: `{ type, content?, rating?, audioBase64?, audioMime?, audioDurationMs?, endUserId, pageUrl }`. Body limit is 10MB. Returns `201` + the saved feedback, including sentiment and category. |
| GET | `/api/feedback?org=<slug>` | Feedback list (newest first). Without `org` it returns everything. |
| GET | `/api/stats` | Per customer: total, by type, by sentiment, by category |
| GET | `/audio/:file` | Plays an audio file from `data/audio` (file name validated, no path traversal) |

**Validation:**
- Unknown key → `401`.
- `type` not text/voice → `400`.
- Text without content → `400`.
- Voice without audio → `400`.
- Text longer than 5,000 characters → `400`.
- Audio is saved as `data/audio/<feedbackId>.webm` (or `.ogg` / `.mp4`, depending on the mime type).

## 6. Widget (`widget.js`)

- Loaded with `<script src="/widget.js" data-api-key="..."></script>`.
- A floating button at the bottom left (the site is RTL). Clicking it opens a Hebrew panel with two tabs: **Text** and **Voice**.
- **Text:** 1–5 star rating (optional) + a free-text field + Send.
- **Voice:**
  - Record / stop button with a timer, limited to 2 minutes. Recording uses `MediaRecorder`.
  - At the same time, a live Hebrew transcript runs through `SpeechRecognition` (or `webkitSpeechRecognition`, `lang='he-IL'`, `continuous`, `interimResults`) and appears on screen.
  - After stopping, the user can listen, re-record, or send.
- A persistent `endUserId` is stored in `localStorage` (inside try/catch; if unavailable, a new ID is used for each session).
- After sending: a thank-you message showing the detected sentiment.

## 7. Demo page and capture

- `scripts/capture.js` runs `msedge.exe --headless=new --hide-scrollbars --window-size=1440,4000 --screenshot=<out> <url>` for each site.
- The Edge path is auto-detected from the standard installation paths, or comes from the `EDGE_PATH` environment variable.
- `site.html?s=shufersal` shows a thin top bar labeled "Intent AI demo · Shufersal (screenshot of the live site)", the screenshot at full width with scrolling, and the widget.
- If the screenshot doesn't exist, it falls back to a page showing the site's name and a message explaining how to run `npm run capture`.

## 8. Dashboard

- `dashboard.html`: customer tabs (currently Shufersal + "All") and summary cards (total, voice/text, sentiment distribution).
- The feedback table shows: date, type, content/transcript, audio player, rating, sentiment, category and page.
- The data is fetched from `/api/feedback` and `/api/stats`. A Refresh button reloads it, and it also auto-refreshes every 10 seconds, so a feedback sent in another tab appears during the demo.
- Hebrew, RTL.

## 9. Local analysis (`analyze.js`)

- **Sentiment:** counts Hebrew positive words (e.g. "מעולה", "אהבתי", "תודה", "נוח") against negative ones (e.g. "גרוע", "תקוע", "לא עובד", "איטי", "מתסכל"). Positive minus negative > 0 → positive, < 0 → negative, otherwise neutral.
- **Rating:** 1–2 pushes toward negative and 4–5 toward positive.
- **Category:** the first match from keyword lists:
  - checkout: "תשלום", "קופה", "כרטיס"
  - delivery: "משלוח", "שליח", "הגיע"
  - prices: "מחיר", "יקר", "מבצע"
  - site: "אתר", "באג", "נתקע", "טעינה"
  - service: "שירות", "נציג"
  - anything else: other.

## 10. Errors

| Situation | Behavior |
|---|---|
| No microphone permission | A clear message in the panel + a suggestion to switch to text |
| Browser without SpeechRecognition | Recording works, the transcript is empty, and a note says "transcription is not supported in this browser" |
| Server down or request failed | An error message in the widget. The draft is kept so the user can resend |
| Missing screenshot | The fallback page from section 7 |
| Edge not found during capture | An error explaining how to set `EDGE_PATH` |

## 11. Testing

- `node --test` with no extra dependencies.
- **`db.test.js`:** seed is idempotent; feedback is saved and retrieved per customer; an end user is created once per `external_id`.
- **`analyze.test.js`:** positive, negative and neutral sentences; the effect of the rating; each category.
- **`api.test.js`:**
  - The app runs on a temporary DB and a temporary audio folder, on a random port.
  - Valid text submission → 201.
  - Voice with base64 → the file exists on disk.
  - Wrong key → 401.
  - Invalid inputs → 400.
  - Filtering by `org`.
  - `/audio` blocks `../`.
- **Manual check before declaring it finished:** a full run in Edge (text + voice + dashboard), and a check that the rows exist in `test.db`.

## 12. Git

- Additions to the root `.gitignore`: `simulation/node_modules/`, `simulation/data/`, `simulation/public/sites/`.
- The code and `sites.json` are committed (only when you ask). The site screenshots and the DB are not uploaded.
