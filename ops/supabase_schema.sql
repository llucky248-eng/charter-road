-- Charter Road: Global Economy Schema
-- Run this in Supabase Dashboard → SQL Editor

-- 1. Market economy: aggregated trade pressure per city/item
CREATE TABLE IF NOT EXISTS market_economy (
  id          SERIAL PRIMARY KEY,
  city_id     TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  pressure    FLOAT NOT NULL DEFAULT 0,  -- positive = demand up (prices rise), negative = supply up (prices fall)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(city_id, item_id)
);

-- 2. Trade events log (raw events, used for aggregation)
CREATE TABLE IF NOT EXISTS trade_events (
  id          BIGSERIAL PRIMARY KEY,
  city_id     TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  direction   TEXT NOT NULL CHECK (direction IN ('buy', 'sell')),
  qty         INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Index for fast aggregation queries
CREATE INDEX IF NOT EXISTS idx_trade_events_city_item ON trade_events(city_id, item_id);
CREATE INDEX IF NOT EXISTS idx_trade_events_created ON trade_events(created_at);

-- 4. Enable Row Level Security (allow anonymous reads + inserts)
ALTER TABLE market_economy ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_events ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read market state
CREATE POLICY "public read market_economy"
  ON market_economy FOR SELECT USING (true);

-- Allow anyone to read trade events
CREATE POLICY "public read trade_events"
  ON trade_events FOR SELECT USING (true);

-- Allow anonymous inserts (players posting trades)
CREATE POLICY "public insert trade_events"
  ON trade_events FOR INSERT WITH CHECK (true);

-- Allow upsert on market_economy (for aggregation function)
CREATE POLICY "public upsert market_economy"
  ON market_economy FOR ALL USING (true);

-- 5. Function: aggregate recent trade events into market_economy pressure
--    Call this via RPC: POST /rest/v1/rpc/aggregate_economy
CREATE OR REPLACE FUNCTION aggregate_economy()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  decay_factor FLOAT := 0.85; -- pressure decays 15% each aggregation
BEGIN
  -- Decay existing pressure toward zero
  UPDATE market_economy
  SET pressure = pressure * decay_factor,
      updated_at = NOW()
  WHERE ABS(pressure) > 0.001;

  -- Remove near-zero rows
  DELETE FROM market_economy WHERE ABS(pressure) < 0.001;

  -- Add new pressure from last hour of trades
  INSERT INTO market_economy (city_id, item_id, pressure, updated_at)
  SELECT
    city_id,
    item_id,
    SUM(CASE WHEN direction = 'buy' THEN qty ELSE -qty END) * 0.02 AS pressure,
    NOW()
  FROM trade_events
  WHERE created_at > NOW() - INTERVAL '1 hour'
  GROUP BY city_id, item_id
  ON CONFLICT (city_id, item_id)
  DO UPDATE SET
    pressure = market_economy.pressure + EXCLUDED.pressure,
    updated_at = NOW();

  -- Clamp pressure to [-0.5, +0.5] (max 50% price swing)
  UPDATE market_economy
  SET pressure = GREATEST(-0.5, LEAST(0.5, pressure));
END;
$$;

-- Allow anonymous users to call the aggregation function
GRANT EXECUTE ON FUNCTION aggregate_economy() TO anon;

-- 6. Seed initial zeroed rows for all city/item combos (optional but useful)
INSERT INTO market_economy (city_id, item_id, pressure) VALUES
  ('valdenmere', 'grain', 0), ('valdenmere', 'cloth', 0), ('valdenmere', 'fish', 0),
  ('valdenmere', 'iron',  0), ('valdenmere', 'herbs', 0), ('valdenmere', 'food', 0),
  ('ashport',    'grain', 0), ('ashport',    'cloth', 0), ('ashport',    'fish', 0),
  ('ashport',    'iron',  0), ('ashport',    'herbs', 0), ('ashport',    'food', 0),
  ('crosshaven', 'grain', 0), ('crosshaven', 'cloth', 0), ('crosshaven', 'fish', 0),
  ('crosshaven', 'iron',  0), ('crosshaven', 'herbs', 0), ('crosshaven', 'food', 0),
  ('ironholt',   'grain', 0), ('ironholt',   'cloth', 0), ('ironholt',   'fish', 0),
  ('ironholt',   'iron',  0), ('ironholt',   'herbs', 0), ('ironholt',   'food', 0)
ON CONFLICT (city_id, item_id) DO NOTHING;
