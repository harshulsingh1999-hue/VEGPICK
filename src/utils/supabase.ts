import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || '').trim();
const supabaseKey = ((import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || '').trim();

export const isSupabaseBrowserConfigured = Boolean(
  supabaseUrl.startsWith('https://') && supabaseKey
);

/**
 * Optional browser-side Supabase client (uses publishable key only).
 * Note: FreshVeggie executes privileged relational archival queries server-side via
 * Express (/api/archive/* and /api/admin/databases/*) using SUPABASE_SERVICE_ROLE_KEY.
 */
export const supabase: SupabaseClient | null = isSupabaseBrowserConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null;
