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

-- 8. World caches: first-come-first-served loot (tile 13)
CREATE TABLE IF NOT EXISTS world_caches (
  tile_key      TEXT PRIMARY KEY,          -- "tx,ty"
  opened_by_uid TEXT NOT NULL,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE world_caches ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='world_caches' AND policyname='public read world_caches')
  THEN CREATE POLICY "public read world_caches" ON world_caches FOR SELECT USING (true); END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='world_caches' AND policyname='public insert world_caches')
  THEN CREATE POLICY "public insert world_caches" ON world_caches FOR INSERT WITH CHECK (true); END IF;
END $$;

-- RPC: attempt to claim a cache; returns ok=true only for the first claimer
CREATE OR REPLACE FUNCTION open_cache(p_uid TEXT, p_tile_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO world_caches (tile_key, opened_by_uid)
  VALUES (p_tile_key, p_uid)
  ON CONFLICT (tile_key) DO NOTHING;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true);
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'already_looted');
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION open_cache(TEXT, TEXT) TO anon;

-- 9. Ore veins: global 30-second cooldown per vein tile
CREATE TABLE IF NOT EXISTS ore_veins (
  tile_key        TEXT PRIMARY KEY,         -- ty * MAP_W + tx (as text)
  last_mined_uid  TEXT,
  cooldown_until  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ore_veins ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ore_veins' AND policyname='public read ore_veins')
  THEN CREATE POLICY "public read ore_veins" ON ore_veins FOR SELECT USING (true); END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ore_veins' AND policyname='public upsert ore_veins')
  THEN CREATE POLICY "public upsert ore_veins" ON ore_veins FOR ALL USING (true); END IF;
END $$;

-- RPC: atomically claim a mine swing; denied if within 30-second cooldown
CREATE OR REPLACE FUNCTION mine_ore_vein(p_uid TEXT, p_tile_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_until TIMESTAMPTZ;
BEGIN
  -- Lock the row (or insert a fresh one) atomically
  INSERT INTO ore_veins (tile_key, last_mined_uid, cooldown_until)
  VALUES (p_tile_key, p_uid, NOW() + INTERVAL '30 seconds')
  ON CONFLICT (tile_key) DO UPDATE
    SET last_mined_uid = p_uid,
        cooldown_until = NOW() + INTERVAL '30 seconds'
    WHERE ore_veins.cooldown_until <= NOW()
  RETURNING cooldown_until INTO v_until;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true);
  ELSE
    SELECT cooldown_until INTO v_until FROM ore_veins WHERE tile_key = p_tile_key;
    RETURN jsonb_build_object(
      'ok', false,
      'cooldown_remaining_ms', EXTRACT(EPOCH FROM (v_until - NOW())) * 1000
    );
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION mine_ore_vein(TEXT, TEXT) TO anon;

-- 10. Shared bank vault (per-city reserve + aggregate deposits + solvency)
ALTER TABLE city_treasury ADD COLUMN IF NOT EXISTS bank_reserve   INT NOT NULL DEFAULT 100;
ALTER TABLE city_treasury ADD COLUMN IF NOT EXISTS total_deposits INT NOT NULL DEFAULT 0;
ALTER TABLE city_treasury ADD COLUMN IF NOT EXISTS bankrupt_day   INT;

-- Seed initial reserves to match client defaults
UPDATE city_treasury SET bank_reserve = 120 WHERE city_id='valdenmere' AND bank_reserve <= 100;
UPDATE city_treasury SET bank_reserve = 80  WHERE city_id='ashport'    AND bank_reserve <= 100;
UPDATE city_treasury SET bank_reserve = 40  WHERE city_id='crosshaven' AND bank_reserve <= 100;
UPDATE city_treasury SET bank_reserve = 60  WHERE city_id='ironholt'   AND bank_reserve <= 100;

-- bank_deposit: atomically add to shared vault + aggregate deposits.
-- The per-player deposit amount stays in player_saves (each player's own ledger).
CREATE OR REPLACE FUNCTION bank_deposit(p_city_id TEXT, p_amount INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_bankrupt INT;
  v_reserve  INT;
  v_total    INT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid amount');
  END IF;
  SELECT bank_reserve, total_deposits, bankrupt_day
    INTO v_reserve, v_total, v_bankrupt
    FROM city_treasury WHERE city_id = p_city_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'city not found');
  END IF;
  IF v_bankrupt IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bank closed');
  END IF;
  UPDATE city_treasury
    SET bank_reserve   = bank_reserve   + p_amount,
        total_deposits = total_deposits + p_amount,
        updated_at     = NOW()
    WHERE city_id = p_city_id;
  RETURN jsonb_build_object('ok', true, 'bank_reserve', v_reserve + p_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION bank_deposit(TEXT, INT) TO anon;

-- bank_withdraw: pays out from vault; partial if insolvent. Caller passes the
-- amount they expect (their owed amount); RPC returns what it could actually pay.
CREATE OR REPLACE FUNCTION bank_withdraw(p_city_id TEXT, p_amount INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_reserve INT;
  v_paid    INT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid amount');
  END IF;
  SELECT bank_reserve INTO v_reserve
    FROM city_treasury WHERE city_id = p_city_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'city not found');
  END IF;
  v_paid := LEAST(p_amount, GREATEST(0, v_reserve));
  UPDATE city_treasury
    SET bank_reserve   = bank_reserve - v_paid,
        total_deposits = GREATEST(0, total_deposits - p_amount),
        updated_at     = NOW()
    WHERE city_id = p_city_id;
  RETURN jsonb_build_object('ok', true, 'paid', v_paid, 'bank_reserve', v_reserve - v_paid);
END;
$$;
GRANT EXECUTE ON FUNCTION bank_withdraw(TEXT, INT) TO anon;

-- bank_loan: lends from vault if it has enough; tracked per-player in playerBank locally.
CREATE OR REPLACE FUNCTION bank_loan(p_city_id TEXT, p_amount INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_reserve  INT;
  v_bankrupt INT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid amount');
  END IF;
  SELECT bank_reserve, bankrupt_day INTO v_reserve, v_bankrupt
    FROM city_treasury WHERE city_id = p_city_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'city not found');
  END IF;
  IF v_bankrupt IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bank closed');
  END IF;
  IF v_reserve < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient reserve', 'bank_reserve', v_reserve);
  END IF;
  UPDATE city_treasury
    SET bank_reserve = bank_reserve - p_amount,
        updated_at   = NOW()
    WHERE city_id = p_city_id;
  RETURN jsonb_build_object('ok', true, 'bank_reserve', v_reserve - p_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION bank_loan(TEXT, INT) TO anon;

-- bank_repay: returns loan principal+fee to the vault.
CREATE OR REPLACE FUNCTION bank_repay(p_city_id TEXT, p_amount INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_reserve INT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid amount');
  END IF;
  UPDATE city_treasury
    SET bank_reserve = bank_reserve + p_amount,
        updated_at   = NOW()
    WHERE city_id = p_city_id
    RETURNING bank_reserve INTO v_reserve;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'city not found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'bank_reserve', v_reserve);
END;
$$;
GRANT EXECUTE ON FUNCTION bank_repay(TEXT, INT) TO anon;

-- 11. Shared contract boards (per-city contract listings, server-regenerated)
ALTER TABLE world_state ADD COLUMN IF NOT EXISTS contract_boards JSONB NOT NULL DEFAULT '{}';
ALTER TABLE world_state ADD COLUMN IF NOT EXISTS contract_regen  JSONB NOT NULL DEFAULT '{}';

-- 12. Safe city treasury upsert — merges buildings via JSONB || so only touched
--     slots are written. This prevents stale in-memory slots (built:false) from
--     overwriting DB rows that were set to built:true by a previous donation RPC.
CREATE OR REPLACE FUNCTION upsert_city_treasury(
  p_city_id    TEXT,
  p_gold       INT,
  p_invest_log JSONB,
  p_city_bonus JSONB,
  p_buildings  JSONB,   -- only touched (built or funded) slots; merged into existing
  p_updated_at TIMESTAMPTZ
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO city_treasury (city_id, gold, invest_log, city_bonus, buildings, updated_at)
  VALUES (p_city_id, p_gold, p_invest_log, p_city_bonus, p_buildings, p_updated_at)
  ON CONFLICT (city_id) DO UPDATE SET
    gold        = EXCLUDED.gold,
    invest_log  = EXCLUDED.invest_log,
    city_bonus  = EXCLUDED.city_bonus,
    -- merge: existing keys survive; touched slots are updated / added
    buildings   = city_treasury.buildings || EXCLUDED.buildings,
    updated_at  = EXCLUDED.updated_at;
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_city_treasury(TEXT, INT, JSONB, JSONB, JSONB, TIMESTAMPTZ) TO anon;
