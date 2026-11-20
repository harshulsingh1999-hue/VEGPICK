-- FreshVeggie Delivery: Multi-Cloud Supabase PostgreSQL Schema, RBAC Profiles & RLS Policies
-- Supports unified roles ('customer' | 'delivery' | 'admin') + historical relational analytics archive.

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

-- =====================================================================
-- 3. Row-Level Security (RLS) Policies
-- =====================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger_archive ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile; only admins or backend service_role can mutate roles/approvals
CREATE POLICY "Users read own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins manage all profiles"
  ON public.profiles
  FOR ALL
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- Customers read own archived orders; approved riders read assigned orders; admins + service_role full access
CREATE POLICY "Customer read own archived orders"
  ON public.order_archive
  FOR SELECT
  USING (user_id = auth.uid()::text OR assigned_to_uid = auth.uid()::text OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Service role full access on order_archive"
  ON public.order_archive
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Partner read own ledger archive"
  ON public.wallet_ledger_archive
  FOR SELECT
  USING (partner_uid = auth.uid()::text OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Service role full access on wallet_ledger_archive"
  ON public.wallet_ledger_archive
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
