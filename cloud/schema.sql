-- Intent AI demo · Cloudflare D1 (SQLite) schema for the always-on link.
-- Same fields as the local TEST DB; sites come from ../simulation/sites.json.
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'voice')),
  content TEXT,
  audio_path TEXT,
  audio_duration_ms INTEGER,
  rating INTEGER,
  sentiment TEXT,
  category TEXT,
  page_url TEXT,
  end_user_id TEXT NOT NULL,
  browser TEXT, os TEXT, device TEXT, language TEXT, time_zone TEXT, country TEXT,
  ip_hash TEXT,
  feedback_lang TEXT,
  channel TEXT,
  consent_version TEXT,
  consent_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_site_created ON feedback (site, created_at);
CREATE INDEX IF NOT EXISTS feedback_ip_recent ON feedback (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS feedback_user ON feedback (site, end_user_id);

-- Voice recordings (kept in D1 so no paid storage is needed; capped at 2 MB each)
CREATE TABLE IF NOT EXISTS audio (
  path TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL
);
