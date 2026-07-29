-- Harmony Verify schema.
--
-- Constraints are declared in the database rather than left to application code:
-- an invalid status or a review pointing at a missing submission should be
-- impossible to persist, not merely unlikely.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role          TEXT NOT NULL CHECK (role IN ('customer','expert','admin')),
  organisation  TEXT,
  created_at    TEXT NOT NULL
);

-- Split from users so a query that returns a user can never leak a hash.
CREATE TABLE IF NOT EXISTS user_credentials (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('customer','expert','admin')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS experts (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  specialty              TEXT NOT NULL CHECK (specialty IN
                           ('cardiology','oncology','neurology','radiology','general-medicine','other')),
  sub_specialty          TEXT,
  credentials            TEXT NOT NULL,
  years_experience       INTEGER NOT NULL CHECK (years_experience >= 0),
  availability           TEXT NOT NULL CHECK (availability IN ('available','busy','unavailable')),
  rating                 REAL NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  rating_count           INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL CHECK (status IN ('pending','active','suspended')),
  conflicts_of_interest  TEXT NOT NULL DEFAULT '[]',
  active_case_count      INTEGER NOT NULL DEFAULT 0 CHECK (active_case_count >= 0),
  max_concurrent_cases   INTEGER NOT NULL DEFAULT 5 CHECK (max_concurrent_cases > 0),
  created_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_experts_routing ON experts(specialty, status, availability);

CREATE TABLE IF NOT EXISTS submissions (
  id                 TEXT PRIMARY KEY,
  customer_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  ai_system          TEXT NOT NULL,
  content            TEXT NOT NULL,
  file_url           TEXT,
  specialty          TEXT NOT NULL CHECK (specialty IN
                       ('cardiology','oncology','neurology','radiology','general-medicine','other')),
  review_type        TEXT NOT NULL CHECK (review_type IN
                       ('single-verification','deep-clinical-review','continuous-monitoring')),
  priority           TEXT NOT NULL CHECK (priority IN ('standard','urgent','critical')),
  complexity         TEXT CHECK (complexity IN ('low','medium','high')),
  risk_level         TEXT CHECK (risk_level IN ('low','medium','high')),
  status             TEXT NOT NULL CHECK (status IN
                       ('submitted','analyzing','expert-assigned','under-review','completed','cancelled')),
  assigned_expert_id TEXT REFERENCES experts(id) ON DELETE SET NULL,
  price_cents        INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  eta                TEXT,
  report_url         TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_customer ON submissions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_expert   ON submissions(assigned_expert_id, status);
CREATE INDEX IF NOT EXISTS idx_submissions_status   ON submissions(status);

CREATE TABLE IF NOT EXISTS reviews (
  id                          TEXT PRIMARY KEY,
  submission_id               TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  expert_id                   TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  status                      TEXT NOT NULL CHECK (status IN ('assigned','accepted','rejected','submitted')),
  accuracy                    TEXT CHECK (accuracy IN ('accurate','minor-issues','incorrect')),
  hallucination_detected      INTEGER CHECK (hallucination_detected IN (0,1)),
  hallucination_details       TEXT,
  missing_information         INTEGER CHECK (missing_information IN (0,1)),
  missing_information_details TEXT,
  safety_level                TEXT CHECK (safety_level IN ('safe','needs-revision','unsafe')),
  clinical_reasoning          TEXT CHECK (clinical_reasoning IN ('strong','questionable','poor')),
  verdict                     TEXT CHECK (verdict IN ('verified','needs-revision','unsafe')),
  comments                    TEXT,
  assigned_at                 TEXT NOT NULL,
  accepted_at                 TEXT,
  submitted_at                TEXT,
  -- One review per expert per submission.
  UNIQUE (submission_id, expert_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_expert ON reviews(expert_id, status);

CREATE TABLE IF NOT EXISTS reports (
  id                 TEXT PRIMARY KEY,
  submission_id      TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  verification_score INTEGER NOT NULL CHECK (verification_score BETWEEN 0 AND 100),
  summary            TEXT NOT NULL,
  pdf_url            TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency      TEXT NOT NULL DEFAULT 'USD',
  status        TEXT NOT NULL CHECK (status IN ('pending','paid','failed','refunded')),
  provider      TEXT NOT NULL,
  reference     TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_submission ON payments(submission_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT NOT NULL,
  actor_role  TEXT NOT NULL CHECK (actor_role IN ('customer','expert','admin')),
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  metadata    TEXT,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_type, target_id);
