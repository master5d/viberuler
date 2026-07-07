CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gh_id INTEGER UNIQUE NOT NULL,
  gh_login TEXT NOT NULL,
  avatar_url TEXT,
  gh_created_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  vibe_score REAL NOT NULL,
  loc INTEGER NOT NULL DEFAULT 0,
  projects INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  tok_per_usd REAL,
  achievements TEXT NOT NULL DEFAULT '[]',
  breakdown TEXT NOT NULL DEFAULT '{}',
  sus INTEGER NOT NULL DEFAULT 0,
  client_version TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_scores_user_time ON scores(user_id, submitted_at DESC);
CREATE INDEX idx_scores_user_id ON scores(user_id, id DESC);
