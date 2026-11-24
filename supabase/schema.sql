-- FreshVeggie Delivery: Multi-Cloud Supabase PostgreSQL Schema, RBAC Profiles & RLS Policies
-- Safe & Idempotent: Run this entire script in Supabase Console -> SQL Editor -> New Query -> Run.

-- =====================================================================
-- 1. Unified RBAC Profiles Table (Customer, Delivery Partner, Admin)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'delivery', 'admin')),
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  fcm_token TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role, is_approved);

-- =====================================================================
-- 2. Historical Relational Order & Rider Wallet Archive (1M DAU Analytics)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.order_archive (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'placed',
  payment_method TEXT NOT NULL DEFAULT 'cod',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  assigned_to_uid TEXT NOT NULL DEFAULT '',
  item_count INTEGER NOT NULL DEFAULT 0,
  order_date TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_archive_status ON public.order_archive (status);
CREATE INDEX IF NOT EXISTS idx_order_archive_city ON public.order_archive (city);
CREATE INDEX IF NOT EXISTS idx_order_archive_date ON public.order_archive (order_date DESC);

CREATE TABLE IF NOT EXISTS public.wallet_ledger_archive (
  id TEXT PRIMARY KEY,
  partner_uid TEXT NOT NULL,
  order_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_partner ON public.wallet_ledger_archive (partner_uid, created_at DESC);

CREATE TABLE IF NOT EXISTS public.catalog_snapshot (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);

-- =====================================================================
-- 3. Row-Level Security (RLS) Policies (Idempotent)
-- =====================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_snapshot ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin_profile()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile"
  ON public.profiles
  FOR SELECT
  USING (
    auth.uid() = id
    OR public.is_admin_profile()
  );

DROP POLICY IF EXISTS "Admins manage all profiles" ON public.profiles;
CREATE POLICY "Admins manage all profiles"
  ON public.profiles
  FOR ALL
  USING (public.is_admin_profile())
  WITH CHECK (public.is_admin_profile());

DROP POLICY IF EXISTS "Customer read own archived orders" ON public.order_archive;
CREATE POLICY "Customer read own archived orders"
  ON public.order_archive
  FOR SELECT
  USING (
    user_id = auth.uid()::text
    OR assigned_to_uid = auth.uid()::text
    OR public.is_admin_profile()
  );

DROP POLICY IF EXISTS "Service role full access on order_archive" ON public.order_archive;
CREATE POLICY "Service role full access on order_archive"
  ON public.order_archive
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS "Partner read own ledger archive" ON public.wallet_ledger_archive;
CREATE POLICY "Partner read own ledger archive"
  ON public.wallet_ledger_archive
  FOR SELECT
  USING (
    partner_uid = auth.uid()::text
    OR public.is_admin_profile()
  );

DROP POLICY IF EXISTS "Service role full access on wallet_ledger_archive" ON public.wallet_ledger_archive;
CREATE POLICY "Service role full access on wallet_ledger_archive"
  ON public.wallet_ledger_archive
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS "Service role full access on catalog_snapshot" ON public.catalog_snapshot;
CREATE POLICY "Service role full access on catalog_snapshot"
  ON public.catalog_snapshot
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
