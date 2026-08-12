-- Brandora schema.
--
-- Constraints live in the database rather than in application code. An order
-- pointing at a missing quote, a project with no owner, or a status nobody
-- defined should be impossible to persist, not merely unlikely — application
-- checks are skipped by the next script someone writes against this file.
--
-- Money is stored as an integer amount plus its currency code, never as a float
-- and never as a bare number. XOF is zero-decimal and USD is not, so an amount
-- without its currency is not a price, it is a number.

PRAGMA foreign_keys = ON;

/* --- People --------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('customer','admin','supplier')),
  locale     TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','fr','es')),
  currency   TEXT NOT NULL DEFAULT 'XOF',
  country    TEXT,
  phone      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Split from users so a query that returns a user can never leak a hash by
-- accident. Selecting a user is the common operation; selecting a credential
-- is rare and deliberate.
CREATE TABLE IF NOT EXISTS user_credentials (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

/* --- Brand projects ------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS brand_projects (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('draft','interviewing','generated','active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON brand_projects(user_id);

-- One interview per project. Responses are JSON because the question set is
-- owned by @brandora/brand-engine and will change; a column per question would
-- turn every wording change into a migration.
CREATE TABLE IF NOT EXISTS interviews (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL UNIQUE REFERENCES brand_projects(id) ON DELETE CASCADE,
  responses    TEXT NOT NULL,
  completed_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brand_strategies (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL UNIQUE REFERENCES brand_projects(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  description           TEXT NOT NULL,
  industry              TEXT NOT NULL,
  positioning           TEXT NOT NULL CHECK (positioning IN
                          ('affordable','accessible-premium','premium','luxury','contemporary','mass-market')),
  target_customer       TEXT NOT NULL,
  personality           TEXT NOT NULL,
  promise               TEXT NOT NULL,
  mission               TEXT NOT NULL,
  vision                TEXT NOT NULL,
  slogan                TEXT NOT NULL,
  tone_of_voice         TEXT NOT NULL,
  brand_story           TEXT NOT NULL,
  name_alternatives     TEXT NOT NULL,
  -- The exact validated payload the model returned. Kept so a strategy can be
  -- audited or re-derived later without re-running a paid generation, and so a
  -- prompt change can be evaluated against what the old prompt actually
  -- produced rather than against a memory of it.
  raw_validated_output  TEXT NOT NULL,
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brand_identities (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL UNIQUE REFERENCES brand_projects(id) ON DELETE CASCADE,
  palette      TEXT NOT NULL,
  typography   TEXT NOT NULL,
  logo_brief   TEXT NOT NULL,
  logo_url     TEXT,
  visual_rules TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

/* --- Products ------------------------------------------------------------- */

-- Cached supplier products, normalised into Brandora's model before they land
-- here. `last_checked_at` is not decoration: §75 requires Brandora to know when
-- a price was last confirmed, and a row with no timestamp is a row nobody can
-- reason about.
CREATE TABLE IF NOT EXISTS products (
  id                   TEXT PRIMARY KEY,
  supplier             TEXT NOT NULL,
  external_id          TEXT NOT NULL,
  title                TEXT NOT NULL,
  description          TEXT,
  images               TEXT NOT NULL DEFAULT '[]',
  supplier_price       INTEGER,
  supplier_currency    TEXT,
  brandora_price       INTEGER,
  currency             TEXT NOT NULL,
  moq                  INTEGER NOT NULL DEFAULT 1,
  available_quantity   INTEGER NOT NULL DEFAULT 0,
  shipping_estimate    TEXT,
  stock_status         TEXT NOT NULL DEFAULT 'unknown'
                         CHECK (stock_status IN ('in-stock','low','out-of-stock','unknown')),
  customization_status TEXT NOT NULL DEFAULT 'unknown'
                         CHECK (customization_status IN ('verified','reported','unknown','unavailable')),
  metadata             TEXT NOT NULL DEFAULT '{}',
  last_checked_at      TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE (supplier, external_id)
);

/* --- Quotes and orders ---------------------------------------------------- */

CREATE TABLE IF NOT EXISTS quotes (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES brand_projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference   TEXT NOT NULL UNIQUE,
  currency    TEXT NOT NULL,
  line_items  TEXT NOT NULL,
  subtotal    INTEGER NOT NULL,
  shipping    INTEGER NOT NULL DEFAULT 0,
  fees        INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL,
  -- Internal. Never selected by a customer-facing query; see the repository,
  -- which has no method that returns it to a customer.
  margin      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL CHECK (status IN ('draft','sent','approved','rejected','expired')),
  valid_until TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_project ON quotes(project_id);

CREATE TABLE IF NOT EXISTS orders (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id         TEXT NOT NULL REFERENCES brand_projects(id) ON DELETE CASCADE,
  quote_id           TEXT NOT NULL REFERENCES quotes(id),
  reference          TEXT NOT NULL UNIQUE,
  payment_status     TEXT NOT NULL CHECK (payment_status IN ('unpaid','pending','paid','failed','refunded')),
  fulfillment_status TEXT NOT NULL CHECK (fulfillment_status IN
                       ('pending','confirmed','sourcing','processing','shipped','delivered','cancelled')),
  total              INTEGER NOT NULL,
  currency           TEXT NOT NULL,
  supplier_order_id  TEXT,
  tracking_number    TEXT,
  carrier            TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

-- Append-only. An order's history is evidence when a customer asks why their
-- order sat for three days, so rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS order_events (
  id       TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  at       TEXT NOT NULL,
  kind     TEXT NOT NULL,
  detail   TEXT,
  actor    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);
