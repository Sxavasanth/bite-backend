require('dotenv').config();
const pool = require('../src/db/pool');

const SQL = `
-- ── Users ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(255) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,
  phone       VARCHAR(20),
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Addresses ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       VARCHAR(50) DEFAULT 'Home',
  line1       TEXT NOT NULL,
  line2       TEXT,
  city        VARCHAR(100) NOT NULL,
  state       VARCHAR(50) NOT NULL,
  zip         VARCHAR(20) NOT NULL,
  is_default  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Restaurants ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(150) NOT NULL,
  description  TEXT,
  emoji        VARCHAR(10),
  category     VARCHAR(80) NOT NULL,
  tags         TEXT[],
  rating       NUMERIC(2,1) DEFAULT 0,
  review_count INT DEFAULT 0,
  delivery_fee NUMERIC(6,2) DEFAULT 0,
  delivery_min INT DEFAULT 20,
  min_order    NUMERIC(6,2) DEFAULT 0,
  is_open      BOOLEAN DEFAULT TRUE,
  image_url    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Menu categories ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  sort_order    INT DEFAULT 0
);

-- ── Menu items ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id   UUID REFERENCES menu_categories(id) ON DELETE SET NULL,
  name          VARCHAR(150) NOT NULL,
  description   TEXT,
  price         NUMERIC(8,2) NOT NULL,
  emoji         VARCHAR(10),
  image_url     TEXT,
  is_available  BOOLEAN DEFAULT TRUE,
  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Orders ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id),
  address_id      UUID REFERENCES addresses(id),
  status          VARCHAR(30) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','preparing','out_for_delivery','delivered','cancelled')),
  subtotal        NUMERIC(10,2) NOT NULL,
  delivery_fee    NUMERIC(6,2) NOT NULL DEFAULT 0,
  tax             NUMERIC(8,2) NOT NULL DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL,
  promo_code      VARCHAR(30),
  discount        NUMERIC(8,2) DEFAULT 0,
  notes           TEXT,
  estimated_mins  INT DEFAULT 30,
  placed_at       TIMESTAMPTZ DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ
);

-- ── Order items ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id),
  name         VARCHAR(150) NOT NULL,
  price        NUMERIC(8,2) NOT NULL,
  quantity     INT NOT NULL DEFAULT 1,
  subtotal     NUMERIC(10,2) NOT NULL
);

-- ── Reviews ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  order_id      UUID REFERENCES orders(id),
  rating        INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, order_id)
);

-- ── Promo codes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promo_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(30) UNIQUE NOT NULL,
  discount_type   VARCHAR(10) NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value  NUMERIC(8,2) NOT NULL,
  min_order       NUMERIC(8,2) DEFAULT 0,
  max_uses        INT,
  used_count      INT DEFAULT 0,
  expires_at      TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT TRUE
);

-- ── Indexes ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_user     ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);
CREATE INDEX IF NOT EXISTS idx_menu_items_rest ON menu_items(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rest    ON reviews(restaurant_id);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migrations…');
    await client.query(SQL);
    console.log('✅ All tables created.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
