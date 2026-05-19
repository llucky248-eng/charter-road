-- Charter Road: Multiplayer Service-First Migration
-- Run this in Supabase Dashboard → SQL Editor
-- Adds: world_state, player_presence, world_events tables
-- Extends city_treasury with hunger + migration_log columns

-- 1. World time (authoritative server-side clock)
CREATE TABLE IF NOT EXISTS world_state (
  id          TEXT PRIMARY KEY DEFAULT 'main',
  day         FLOAT NOT NULL DEFAULT 1,
  frac        FLOAT NOT NULL DEFAULT 0,
  seed        BIGINT NOT NULL DEFAULT 42,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE world_state ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='world_state' AND policyname='public read world_state')
  THEN CREATE POLICY "public read world_state" ON world_state FOR SELECT USING (true); END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='world_state' AND policyname='public upsert world_state')
  THEN CREATE POLICY "public upsert world_state" ON world_state FOR ALL USING (true); END IF;
END $$;
INSERT INTO world_state (id, day, frac, seed) VALUES ('main', 1, 0, 42)
ON CONFLICT (id) DO NOTHING;

-- 2. Player presence (live positions for multiplayer visibility)
CREATE TABLE IF NOT EXISTS player_presence (
  uid         TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT 'Trader',
  city_id     TEXT,
  x           FLOAT,
  y           FLOAT,
  gold        INT DEFAULT 0,
  facing_x    FLOAT DEFAULT 0,
  facing_y    FLOAT DEFAULT 1,
  gear_pack   INT DEFAULT 0,
  gear_boots  INT DEFAULT 0,
  color       TEXT DEFAULT '#a78bfa',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE player_presence ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='player_presence' AND policyname='public read player_presence')
  THEN CREATE POLICY "public read player_presence" ON player_presence FOR SELECT USING (true); END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='player_presence' AND policyname='public upsert player_presence')
  THEN CREATE POLICY "public upsert player_presence" ON player_presence FOR ALL USING (true); END IF;
END $$;

-- 3. World events log (optional — for event history / news feed)
CREATE TABLE IF NOT EXISTS world_events (
  id          BIGSERIAL PRIMARY KEY,
  event_type  TEXT NOT NULL,
  city_id     TEXT,
  data        JSONB,
  world_day   FLOAT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE world_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='world_events' AND policyname='public read world_events')
  THEN CREATE POLICY "public read world_events" ON world_events FOR SELECT USING (true); END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='world_events' AND policyname='public insert world_events')
  THEN CREATE POLICY "public insert world_events" ON world_events FOR INSERT WITH CHECK (true); END IF;
END $$;

-- 4. Extend city_treasury with per-city simulation columns
ALTER TABLE city_treasury ADD COLUMN IF NOT EXISTS hunger        FLOAT NOT NULL DEFAULT 0;
ALTER TABLE city_treasury ADD COLUMN IF NOT EXISTS migration_log JSONB NOT NULL DEFAULT '[]';

-- 5. World state: market drift + event columns (world-authoritative, ticked by cron)
ALTER TABLE world_state ADD COLUMN IF NOT EXISTS market_drift      JSONB NOT NULL DEFAULT '{}';
ALTER TABLE world_state ADD COLUMN IF NOT EXISTS market_drift_day  INT   NOT NULL DEFAULT 0;
ALTER TABLE world_state ADD COLUMN IF NOT EXISTS active_events     JSONB NOT NULL DEFAULT '[]';
ALTER TABLE world_state ADD COLUMN IF NOT EXISTS next_event_day    INT   NOT NULL DEFAULT 0;

-- 6. Building donations ledger (attribution + leaderboard)
CREATE TABLE IF NOT EXISTS building_donations (
  id        BIGSERIAL PRIMARY KEY,
  uid       TEXT NOT NULL,
  city_id   TEXT NOT NULL,
  slot_key  TEXT NOT NULL,
  amount    INT  NOT NULL CHECK (amount > 0),
  at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bld_donations_city ON building_donations(city_id, slot_key);
CREATE INDEX IF NOT EXISTS idx_bld_donations_uid  ON building_donations(uid);
ALTER TABLE building_donations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='building_donations' AND policyname='public read building_donations')
  THEN CREATE POLICY "public read building_donations" ON building_donations FOR SELECT USING (true); END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='building_donations' AND policyname='public insert building_donations')
  THEN CREATE POLICY "public insert building_donations" ON building_donations FOR INSERT WITH CHECK (true); END IF;
END $$;

-- 7. Atomic building donation RPC
--    Locks the city_treasury row, increments playerFunded, upgrades slot if fully funded,
--    and logs the donation — all in one transaction so concurrent players can't race.
--    p_next_cost is passed by the client (same value the client displays) to gate completion.
CREATE OR REPLACE FUNCTION donate_to_building(
  p_uid       TEXT,
  p_city_id   TEXT,
  p_slot_key  TEXT,
  p_amount    INT,
  p_next_cost INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_buildings  JSONB;
  v_slot       JSONB;
  v_funded     INT;
  v_new_funded INT;
  v_completed  BOOLEAN := false;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid amount');
  END IF;

  -- Exclusive lock prevents concurrent races on the same city
  SELECT buildings INTO v_buildings
  FROM city_treasury WHERE city_id = p_city_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'city not found');
  END IF;

  v_slot       := COALESCE(v_buildings -> p_slot_key, '{"level":0,"built":false,"playerFunded":0}'::jsonb);
  v_funded     := COALESCE((v_slot->>'playerFunded')::INT, 0);
  v_new_funded := LEAST(v_funded + p_amount, p_next_cost);

  v_buildings := jsonb_set(v_buildings, ARRAY[p_slot_key, 'playerFunded'], to_jsonb(v_new_funded));

  IF v_new_funded >= p_next_cost THEN
    v_completed := true;
    v_buildings := jsonb_set(v_buildings, ARRAY[p_slot_key, 'playerFunded'], '0'::jsonb);
    v_buildings := jsonb_set(v_buildings, ARRAY[p_slot_key, 'level'],
                    to_jsonb(COALESCE((v_slot->>'level')::INT, 0) + 1));
    v_buildings := jsonb_set(v_buildings, ARRAY[p_slot_key, 'built'], 'true'::jsonb);
  END IF;

  UPDATE city_treasury SET buildings = v_buildings, updated_at = NOW()
  WHERE city_id = p_city_id;

  INSERT INTO building_donations (uid, city_id, slot_key, amount)
  VALUES (p_uid, p_city_id, p_slot_key, p_amount);

  RETURN jsonb_build_object(
    'ok',        true,
    'buildings', v_buildings,
    'completed', v_completed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION donate_to_building(TEXT, TEXT, TEXT, INT, INT) TO anon;
