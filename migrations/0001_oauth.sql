CREATE TABLE IF NOT EXISTS oauth_state (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS oauth_expiry ON oauth_state(expires);
