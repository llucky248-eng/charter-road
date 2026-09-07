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
  v_now        TIMESTAMPTZ := NOW();
BEGIN
  -- Decay existing pressure toward zero
  UPDATE market_economy
  SET pressure = pressure * decay_factor,
      updated_at = v_now
  WHERE ABS(pressure) > 0.001;

  -- Remove near-zero rows
  DELETE FROM market_economy WHERE ABS(pressure) < 0.001;

  -- Consume trade events exactly once. The old version re-folded a trailing
  -- time window on every call, so one trade added pressure once per aggregation
  -- run (world cron every ~5 min + each client hourly) — pressure tracked how
  -- OFTEN aggregation ran, not trade volume. Here DELETE ... RETURNING removes
  -- precisely the rows visible to this transaction and folds them in. Rows
  -- inserted concurrently but not yet committed are not visible, so they are
  -- neither deleted nor counted now — they simply remain for the next run. That
  -- gives exactly-once semantics with no double-count (old bug) and no silent
  -- skip: concurrent aggregate calls serialize on the DELETE's row locks and
  -- each removes a disjoint set. trade_events is an append-only aggregation feed
  -- (only ever INSERTed, never read elsewhere), so consuming by deletion is its
  -- intended lifecycle and also bounds table growth.
  WITH consumed AS (
    DELETE FROM trade_events
    RETURNING city_id, item_id, direction, qty
  )
  INSERT INTO market_economy (city_id, item_id, pressure, updated_at)
  SELECT
    city_id,
    item_id,
    SUM(CASE WHEN direction = 'buy' THEN qty ELSE -qty END) * 0.02 AS pressure,
    v_now
  FROM consumed
  GROUP BY city_id, item_id
  ON CONFLICT (city_id, item_id)
  DO UPDATE SET
    pressure = market_economy.pressure + EXCLUDED.pressure,
    updated_at = v_now;

  -- Clamp pressure to [-0.5, +0.5] (max 50% price swing)
  UPDATE market_economy
  SET pressure = GREATEST(-0.5, LEAST(0.5, pressure))
  WHERE pressure < -0.5 OR pressure > 0.5;
END;
$$;

-- Allow anonymous users to call the aggregation function
GRANT EXECUTE ON FUNCTION aggregate_economy() TO anon;

-- NOTE: the previous aggregate_economy() only read a trailing 1-hour window and
-- never deleted, so an existing project may hold a large un-consumed backlog in
-- trade_events. The new consume-by-DELETE version folds ALL of it into pressure
-- on its first run — a one-off, clamp-bounded, but economy-wide price jolt. This
-- schema file stays purely idempotent (CREATE ... IF NOT EXISTS), so the backlog
-- prune is NOT run here (a bare DELETE would fire on every re-application). When
-- upgrading a live project, run the one-time prune documented in ops/RUNBOOK.md
-- ("persistence trust model" / aggregation notes) once, by hand, before the
-- first aggregation.

-- 6. Seed initial zeroed rows for all city/item combos (optional but useful)
-- Items: grain, cloth, fish, iron, herbs, food, ore, potion, ink, relic
INSERT INTO market_economy (city_id, item_id, pressure) VALUES
  ('valdenmere', 'grain', 0), ('valdenmere', 'cloth', 0), ('valdenmere', 'fish', 0),
  ('valdenmere', 'iron',  0), ('valdenmere', 'herbs', 0), ('valdenmere', 'food', 0),
  ('valdenmere', 'ore',   0), ('valdenmere', 'potion',0), ('valdenmere', 'ink',  0), ('valdenmere', 'relic', 0),
  ('ashport',    'grain', 0), ('ashport',    'cloth', 0), ('ashport',    'fish', 0),
  ('ashport',    'iron',  0), ('ashport',    'herbs', 0), ('ashport',    'food', 0),
  ('ashport',    'ore',   0), ('ashport',    'potion',0), ('ashport',    'ink',  0), ('ashport',    'relic', 0),
  ('crosshaven', 'grain', 0), ('crosshaven', 'cloth', 0), ('crosshaven', 'fish', 0),
  ('crosshaven', 'iron',  0), ('crosshaven', 'herbs', 0), ('crosshaven', 'food', 0),
  ('crosshaven', 'ore',   0), ('crosshaven', 'potion',0), ('crosshaven', 'ink',  0), ('crosshaven', 'relic', 0),
  ('ironholt',   'grain', 0), ('ironholt',   'cloth', 0), ('ironholt',   'fish', 0),
  ('ironholt',   'iron',  0), ('ironholt',   'herbs', 0), ('ironholt',   'food', 0),
  ('ironholt',   'ore',   0), ('ironholt',   'potion',0), ('ironholt',   'ink',  0), ('ironholt',   'relic', 0)
ON CONFLICT (city_id, item_id) DO NOTHING;

-- 7. City treasury (server-side per-city economy state, managed by world_service)
CREATE TABLE IF NOT EXISTS city_treasury (
  city_id          TEXT PRIMARY KEY,
  gold             INT NOT NULL DEFAULT 0,
  tax_collected    INT NOT NULL DEFAULT 0,
  permit_collected INT NOT NULL DEFAULT 0,
  spent            INT NOT NULL DEFAULT 0,
  population       INT NOT NULL DEFAULT 0,
  invest_log       JSONB NOT NULL DEFAULT '[]',
  city_bonus       JSONB NOT NULL DEFAULT '{}',
  buildings        JSONB NOT NULL DEFAULT '{}',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE city_treasury ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read city_treasury"
  ON city_treasury FOR SELECT USING (true);
CREATE POLICY "public upsert city_treasury"
  ON city_treasury FOR ALL USING (true) WITH CHECK (true);

-- Seed one row per city so world_service can upsert without a prior fetch
INSERT INTO city_treasury (city_id) VALUES
  ('valdenmere'), ('ashport'), ('crosshaven'), ('ironholt')
ON CONFLICT (city_id) DO NOTHING;

-- 8. Player saves (per-player game state, keyed by uid)
CREATE TABLE IF NOT EXISTS player_saves (
  uid         TEXT PRIMARY KEY,
  save_data   JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE player_saves ENABLE ROW LEVEL SECURITY;
-- ⚠️ Both policies are REQUIRED — missing them causes 401 for all writes (incl. uid='0' guest)
-- ⚠️ SECURITY (known gap, see ops/RUNBOOK.md "persistence trust model"):
--    `FOR ALL USING (true)` lets ANY anon client read, overwrite, or DELETE ANY
--    player's save — the client asserts its own Player ID with no auth. Do NOT
--    treat this as safe for persistent shared progress. The real fix is
--    authenticated identities + owner-scoped policies, e.g. once uid = auth.uid():
--      CREATE POLICY "own read"  ON player_saves FOR SELECT USING (uid = auth.uid()::text);
--      CREATE POLICY "own write" ON player_saves FOR ALL    USING (uid = auth.uid()::text)
--                                                           WITH CHECK (uid = auth.uid()::text);
CREATE POLICY "public read player_saves"
  ON player_saves FOR SELECT USING (true);
CREATE POLICY "public upsert player_saves"
  ON player_saves FOR ALL USING (true) WITH CHECK (true);
