CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT,           
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,       
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);