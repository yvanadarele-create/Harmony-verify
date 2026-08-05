-- Les Délices de Grace Lumière — schema.
--
-- Rules that must always hold are declared here rather than trusted to application
-- code: an order cannot carry an unknown status, an order item cannot point at a
-- missing order, and a customer cannot exist twice under the same phone number.
--
-- Categories are rows, not an enum. "Desserts", "pâtisseries", "traiteur", "boissons",
-- "plateaux salés" are inserts, not migrations.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- staff & access

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role       TEXT NOT NULL CHECK (role IN ('owner','staff')),
  created_at TEXT NOT NULL
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
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------- configuration

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------- media

CREATE TABLE IF NOT EXISTS media (
  id         TEXT PRIMARY KEY,
  filename   TEXT NOT NULL,
  url        TEXT NOT NULL,
  alt        TEXT,
  mime_type  TEXT NOT NULL,
  byte_size  INTEGER NOT NULL,
  -- 'gallery' images are Grace's own work; 'inspiration' images are customer uploads
  -- attached to a brief and are never shown in the public gallery.
  source     TEXT NOT NULL DEFAULT 'gallery' CHECK (source IN ('gallery','inspiration')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_source ON media(source, created_at DESC);

-- ---------------------------------------------------------------- catalogue

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  -- how the category is ordered: straight to basket, brief-and-quote, or either
  kind        TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard','custom','both')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  ingredients  TEXT,
  -- NULL for a product that is always quoted (a wedding cake has no shelf price)
  base_price   INTEGER CHECK (base_price IS NULL OR base_price >= 0),
  price_from   INTEGER NOT NULL DEFAULT 0 CHECK (price_from IN (0,1)),
  servings     INTEGER CHECK (servings IS NULL OR servings > 0),
  customisable INTEGER NOT NULL DEFAULT 0 CHECK (customisable IN (0,1)),
  available    INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
  featured     INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured, active);

-- An option row with product_id NULL belongs to the global catalogue that feeds the
-- custom-cake brief (flavours, fillings, decorations, shapes, occasions). Same shape,
-- same admin screen, so the owner edits one kind of thing rather than two.
CREATE TABLE IF NOT EXISTS product_options (
  id          TEXT PRIMARY KEY,
  product_id  TEXT REFERENCES products(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN
                ('size','flavour','filling','decoration','shape','occasion','extra')),
  group_label TEXT NOT NULL,
  label       TEXT NOT NULL,
  price_delta INTEGER NOT NULL DEFAULT 0,
  servings    INTEGER CHECK (servings IS NULL OR servings > 0),
  required    INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
  multiple    INTEGER NOT NULL DEFAULT 0 CHECK (multiple IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_options_product ON product_options(product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_options_kind ON product_options(kind, sort_order);

CREATE TABLE IF NOT EXISTS product_media (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_id   TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, media_id)
);

-- ---------------------------------------------------------------- customers

CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  -- digits only, so "+33 6 12 34 56 78" and "0612345678" resolve to one customer
  phone_key   TEXT NOT NULL UNIQUE,
  whatsapp    TEXT,
  email       TEXT COLLATE NOCASE,
  address     TEXT,
  preferences TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- ---------------------------------------------------------------- orders

CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  reference      TEXT NOT NULL UNIQUE,
  customer_id    TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  kind           TEXT NOT NULL CHECK (kind IN ('standard','custom')),
  status         TEXT NOT NULL CHECK (status IN
                   ('NEW','REVIEWING','QUOTE_SENT','CONFIRMED','DEPOSIT_PAID',
                    'IN_PRODUCTION','READY','OUT_FOR_DELIVERY','COMPLETED','CANCELLED')),
  requested_date TEXT NOT NULL,
  fulfillment    TEXT NOT NULL CHECK (fulfillment IN ('pickup','delivery')),
  address        TEXT,
  delivery_notes TEXT,
  customer_notes TEXT,
  internal_notes TEXT,
  -- the price Grace confirms; NULL until she quotes. Never computed for a brief.
  quoted_total   INTEGER CHECK (quoted_total IS NULL OR quoted_total >= 0),
  -- the sum of the priced basket lines at the time of ordering
  items_total    INTEGER NOT NULL DEFAULT 0,
  deposit_paid   INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN
                   ('PENDING','DEPOSIT_PAID','PARTIALLY_PAID','PAID','REFUNDED')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, requested_date);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(requested_date);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- kept nullable, and the name copied below, so deleting a product never destroys
  -- the history of what was actually sold
  product_id    TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name  TEXT NOT NULL,
  category_name TEXT NOT NULL,
  unit_price    INTEGER,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  options_json  TEXT NOT NULL DEFAULT '[]',
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS custom_requests (
  id                   TEXT PRIMARY KEY,
  order_id             TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  occasion             TEXT NOT NULL,
  servings             INTEGER,
  shape                TEXT,
  flavour              TEXT,
  filling              TEXT,
  colours              TEXT,
  decoration           TEXT,
  message_on_cake      TEXT,
  inspiration_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  requirements         TEXT
);

CREATE TABLE IF NOT EXISTS order_events (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at);

-- ---------------------------------------------------------------- appointments

CREATE TABLE IF NOT EXISTS appointments (
  id             TEXT PRIMARY KEY,
  customer_id    TEXT REFERENCES customers(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL,
  whatsapp       TEXT,
  email          TEXT,
  preferred_date TEXT,
  preferred_time TEXT,
  reason         TEXT NOT NULL,
  message        TEXT,
  status         TEXT NOT NULL DEFAULT 'NEW'
                   CHECK (status IN ('NEW','SCHEDULED','DONE','CANCELLED')),
  internal_notes TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status, created_at DESC);

-- ---------------------------------------------------------------- inventory

CREATE TABLE IF NOT EXISTS suppliers (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  category       TEXT,
  quantity       REAL NOT NULL DEFAULT 0,
  unit           TEXT NOT NULL DEFAULT 'unité',
  minimum_stock  REAL NOT NULL DEFAULT 0,
  purchase_price INTEGER,
  supplier_id    TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_name ON inventory_items(name);

-- Recipe-based deduction is explicitly out of scope for V1. This table is the seam
-- it will need: a product's bill of materials. Nothing writes to it yet.
CREATE TABLE IF NOT EXISTS product_ingredients (
  product_id        TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity          REAL NOT NULL,
  PRIMARY KEY (product_id, inventory_item_id)
);

-- ---------------------------------------------------------------- testimonials

CREATE TABLE IF NOT EXISTS testimonials (
  id             TEXT PRIMARY KEY,
  customer_name  TEXT NOT NULL,
  body           TEXT NOT NULL,
  photo_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  product_id     TEXT REFERENCES products(id) ON DELETE SET NULL,
  event_date     TEXT,
  published      INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

-- ---------------------------------------------------------------- notifications

-- An outbox. V1 writes the message and marks it sent when a transport accepts it;
-- adding email or WhatsApp delivery later means adding a transport, not a table.
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  channel    TEXT NOT NULL CHECK (channel IN ('email','internal')),
  audience   TEXT NOT NULL CHECK (audience IN ('customer','owner')),
  recipient  TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  order_id   TEXT REFERENCES orders(id) ON DELETE CASCADE,
  read_at    TEXT,
  sent_at    TEXT,
  error      TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
