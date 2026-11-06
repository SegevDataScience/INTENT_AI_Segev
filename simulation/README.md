# Simulation: a local Intent AI demo

A site that runs locally and demonstrates Intent AI on real Israeli sites. A visitor sends feedback by **voice** or **text**, the feedback is saved in the **TEST DB** under the right customer, and the company sees it in the dashboard.

Standalone. It doesn't need Docker, pnpm or paid keys. It needs only Node 22.5+.

## Running it

```bash
cd presentation/simulation
npm install
npm run capture   # takes a screenshot of the real sites with the installed Edge (one time; again when you want to refresh)
npm start
```

| Page | Address |
|---|---|
| Main page: choose a site (Shufersal, El Al, ynet, Super-Pharm, Partner, Ivory, FOX, HOT) | http://localhost:4000 |
| One site's page, e.g. Shufersal | http://localhost:4000/site.html?s=shufersal |
| Dashboard for all sites | http://localhost:4000/dashboard.html |
| Dashboard filtered to one site | http://localhost:4000/dashboard.html?org=elal |

Site slugs: `shufersal`, `elal`, `ynet`, `superpharm`, `partner`, `ivory`, `fox`, `hot`. Each site is captured at desktop width (1440) and phone width (390, `<slug>.m.png`); a phone screen gets the phone screenshot. If the phone capture comes out blank (Super-Pharm), it's deleted and the desktop screenshot is shown instead.

## Double-click launch and sharing a link
- **`presentation/start-demo.bat`:** a local launch. The first run installs dependencies and takes the screenshots. It then starts the server and opens the browser.
- **`presentation/share-demo.bat`** (or `npm run share`): a public link through Cloudflare Tunnel (`cloudflared` is downloaded once from Cloudflare's GitHub into `tools/`, which is git-ignored). The server runs in **share mode**:
  - Visitors get only the sites and the widget. `/api/feedback`, `/api/stats` and `/audio` require `X-Admin-Token` (or `?admin=`), stored in `data/.admin-token`.
  - The owner's page (`/share.html?admin=…`) shows the link, a QR code, and buttons for WhatsApp and email.
  - The visitor IP is taken from `CF-Connecting-IP` (and stored only as a hash). There's a rate limit of 20 feedback items per 10 minutes per visitor.
  - The link changes on every run and stops working when the window closes. The data stays local.

## Languages
The widget works in Hebrew, English and Arabic, with a switcher in the header, `?lang=he|en|ar`, or the browser language. Text direction, transcription (`he-IL` / `en-US` / `ar-IL`), the privacy notice and the keyword analysis follow the language. The chosen language is saved with each feedback (`feedback_lang`) and shown in the dashboard.

### Sites that block automated screenshots
Some sites block headless capture: Bank Hapoalim, Israel Railways and Yad2 were tried and blocked, so the list uses sites that allow it. If a site you add is blocked, its page shows a fallback page and the feedback button works normally. To add a screenshot by hand: open the site in Edge, press `Ctrl+Shift+S`, choose "Capture full page", and save it as `public/sites/<slug>.png`. `npm run capture` warns when a screenshot is suspiciously small.

### Removing a site
Delete it from `sites.json` and restart. The site disappears from the main page and the dashboard, and **its data stays in the DB** (it's marked inactive). Adding it back restores it with its data.

## Privacy and compliance (against `compliance/02_ACTION_ITEMS_CHECKLIST.md`)

| Requirement | Implementation |
|---|---|
| Notice and consent before collection (ENG-001, GDPR 7/13) | The widget opens on a notice screen: what is collected, why, transcription by Google/Microsoft, and retention. A checkbox that isn't pre-checked; nothing is sent before it's checked. The server rejects feedback without consent for the current notice version and stores the consent version and time with each feedback. `/privacy.html` holds the full notice |
| Data minimization (ENG-005) | No name, email or IP. The page address is saved without query parameters or fragment |
| Retention (ENG-002/003/004) | Feedback and recordings are deleted automatically after 90 days (`RETENTION_DAYS`), at server startup and every 24 hours |
| Access and deletion (GDPR 15/17) | Panel footer: "Download my data" (JSON) and "Delete my data" (including the recordings), scoped to the site. API: `GET`/`DELETE /api/my-data` with `X-API-Key` + `X-End-User-Id` |
| Withdraw consent | "Withdraw consent" in the footer; sending again requires consenting again |
| Distinguishing distinct authors | Every feedback stores: the anonymous ID (same ID = same author), browser/OS/device (a summary of the User-Agent only), language and time zone (an estimated country, with no geolocation), and **a one-way HMAC-SHA256 fingerprint of the IP address**. The address itself and the full UA aren't stored. The key lives in `data/.ip-hash-secret` (git-ignored) or comes from `IP_HASH_SECRET`. Locally the IP is always 127.0.0.1, so the fingerprint is identical everywhere. The dashboard shows a "Unique users" card and a "User" column. The "👤 New user" button in the demo bar simulates a new visitor |
| GPC (ANL-007) | When the browser signals `globalPrivacyControl`, the identifier and the consent aren't saved in the browser (session only) |
| Network security | The server listens on `127.0.0.1` only |
| Automated access | `npm run capture` checks robots.txt (RFC 9309) before each capture, doesn't spoof the User-Agent, and doesn't get around blocks |
| Affiliation | A disclaimer "demo only, unaffiliated with the site" in the top bar and on the main page |

Note: the anonymous ID in the browser is the only proof of identity for access and deletion. That's acceptable for a local demo; in production it needs identity verification (ENG-008).

## TEST DB

- The file is `presentation/simulation/data/test.db` (SQLite). The audio recordings are in `presentation/simulation/data/audio/`.
- Tables: `organizations` → `products` (with an API key) → `end_users` → `feedback`. This is a simplified mirror of the product's Prisma schema.
- Reset: `npm run reset`.
- Quick look:
  ```bash
  node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/test.db');console.table(d.prepare('SELECT type,content,sentiment,category,created_at FROM feedback').all())"
  ```

## Raw data research (Jupyter notebook)

`notebooks/raw_data.ipynb`: open it in VS Code (Jupyter extension), choose a Python kernel, and run `Run All`.

- **SOURCE: TEST:** a banner at the top, and a `SOURCE` column with the value `TEST` on every table, so it's clear these are test data and not production.
- **Read-only:** the connection to `data/test.db` is opened with `mode=ro`, so any write is blocked at the SQLite level.
- **Record level:** `record(0)` shows the newest record with all its raw fields, a player if it's a recording, and JSON. `record("<id>")` looks a record up by ID.
- **Trend charts:** hours of the day (bars and an hour × site heatmap, Israel time), feedback and distinct users per site, a daily trend per site, topics, sentiment per site, frequent words, and distinct users per browser. Every chart has a data table underneath.
- **Exploration:** an overview by site, the full `raw` table (pandas), a site filter, recordings without a transcript, sentiment and category distributions, activity over time, and a free SQL query.
- Requirements: Python with `pandas`, `matplotlib` 3.11+ (renders Hebrew on its own) and `ipykernel` (`pip install pandas matplotlib ipykernel`).
- You can keep the notebook open while the server runs: the DB is in WAL mode and the notebook connection is read-only and autocommit, so it doesn't block saving feedback.
- ⚠️ This is raw personal data. **Before a commit, run `Clear All Outputs`**. `npm test` fails if the notebook was saved with outputs.

## Adding a site (customer)

1. Add an entry to `sites.json` (`slug`, `name`, `url`, `industry`, `apiKey`).
2. Run `npm run capture <slug>`.
3. Restart `npm start`. The customer is created in the DB automatically.

## Browser notes

- **Hebrew transcription is not guaranteed.** It relies on the browser's speech service (Chrome/Edge), which sometimes returns empty text for Hebrew without reporting an error. In that case the recording is still saved, the widget shows a note, and the user can type the content by hand. English, by comparison, is transcribed consistently.
- Transcription **needs an internet connection**. Without it, the recording is still saved, just without a transcript.
- Microphone access works on `localhost` without HTTPS. The browser asks for permission on the first recording.
- Sentiment and category come from a free local analysis based on Hebrew keywords. It isn't AI.

## Tests

```bash
npm test
```

The site screenshots (`public/sites/`) and the DB (`data/`) are not uploaded to git.
