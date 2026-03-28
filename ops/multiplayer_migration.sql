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
ALTER TABLE city_treasury ADD COLUMN IF NOT EXISTS hunger FLOAT NOT NULL DEFAULT 0;
ALTER TABLE city_treasury ADD COLUMN IF NOT EXISTS migration_log JSONB NOT NULL DEFAULT '[]';
