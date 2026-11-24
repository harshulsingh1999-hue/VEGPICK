import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  RefreshCw,
  HardDrive,
  Zap,
  ShieldCheck,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ArrowRightLeft
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { adminApiFetch } from '../../lib/apiClient';

interface DatabaseStorageEntry {
  id: string;
  name: string;
  role: string;
  provider: string;
  status: 'connected' | 'degraded' | 'standby';
  latencyMs: number | null;
  usedBytes: number | null;
  freeTierLimitBytes: number | null;
  balanceBytes: number | null;
  recordCount: number | null;
  usageLabel: string;
  balanceLabel: string;
  statusNote?: string | null;
  details: Record<string, string | number | boolean | null>;
}

interface DbControlConfig {
  primaryReadDb: 'auto' | 'firestore' | 'sqlite' | 'upstash';
  autoFailoverEnabled: boolean;
  archivalSyncEnabled: boolean;
  l1CacheEnabled: boolean;
  l2CacheEnabled: boolean;
  storageTarget: 'auto' | 'r2' | 'local';
  firestoreTimeoutMs: number;
  lastFailoverEvent: {
    from: string;
    to: string;
    reason: string;
    at: string;
  } | null;
  updatedAt: string;
}

interface DatabasesReportResponse {
  databases: DatabaseStorageEntry[];
  controlConfig: DbControlConfig;
  checkedAt: string;
}

export const DatabaseControlCenter: React.FC = () => {
  const { firebaseUser } = useAuth();
  const { showToast } = useToast();

  const [report, setReport] = useState<DatabasesReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<DbControlConfig | null>(null);

  const fetchReport = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const token = await firebaseUser.getIdToken();
      const res = await adminApiFetch('/api/admin/databases', token);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to inspect databases');
      }
      setReport(data as DatabasesReportResponse);
      setConfigForm((data as DatabasesReportResponse).controlConfig);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to fetch database telemetry');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !configForm) return;
    setSavingConfig(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await adminApiFetch('/api/admin/databases/config', token, {
        method: 'POST',
        body: JSON.stringify(configForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save DB routing rules');
      setConfigForm(data.controlConfig);
      showToast('Automatic database routing & failover settings updated!', 'success');
      void fetchReport();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update settings', 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleRunAction = async (
    action: 'sync-snapshot' | 'purge-cache' | 'checkpoint-sqlite' | 'sync-supabase'
  ) => {
    if (!firebaseUser) return;
    setRunningAction(action);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await adminApiFetch('/api/admin/databases/action', token, {
        method: 'POST',
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Database action failed');
      showToast(data.message || 'Action completed', 'success');
      void fetchReport();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Database &amp; Cloud Storage Control Center</h2>
          <p className="text-sm text-gray-500">
            Live multi-cloud storage usage, free-tier balance headroom, and automatic database failover &amp; switching controls.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchReport()}
          disabled={loading}
          className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Probing Clouds...' : 'Refresh Live Telemetry'}
        </button>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-2xl text-xs font-semibold flex items-center gap-2">
          <AlertTriangle size={16} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Automatic Database Switching & Failover Control Panel */}
      {configForm && (
        <form
          onSubmit={handleSaveConfig}
          className="bg-white rounded-2xl border border-gray-100 shadow-xs p-5 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <ArrowRightLeft size={18} />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 text-base">
                  Automatic Database Failover &amp; Switching Engine
                </h3>
                <p className="text-xs text-gray-500">
                  Control primary catalog read routing, cache tiers, Supabase archival sync, and media failover targets.
                </p>
              </div>
            </div>
            <button
              type="submit"
              disabled={savingConfig}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xs"
            >
              {savingConfig ? 'Applying...' : 'Apply Routing Policy'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">
                Primary Catalog Read Database
              </label>
              <select
                value={configForm.primaryReadDb}
                onChange={(e) =>
                  setConfigForm({
                    ...configForm,
                    primaryReadDb: e.target.value as DbControlConfig['primaryReadDb']
                  })
                }
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="auto">Auto Multi-Cloud (L1 → Upstash → Firestore → SQLite)</option>
                <option value="firestore">Direct Cloud Firestore REST</option>
                <option value="sqlite">SQLite WAL Edge Replica First</option>
                <option value="upstash">Upstash Redis L2 First</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">
                Media Object Storage Target
              </label>
              <select
                value={configForm.storageTarget}
                onChange={(e) =>
                  setConfigForm({
                    ...configForm,
                    storageTarget: e.target.value as DbControlConfig['storageTarget']
                  })
                }
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="auto">Auto (Cloudflare R2 → /uploads Fallback)</option>
                <option value="r2">Cloudflare R2 Priority</option>
                <option value="local">Express Static /uploads Only</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">
                Firestore Auto-Switch Timeout (ms)
              </label>
              <input
                type="number"
                min={1000}
                max={15000}
                step={250}
                value={configForm.firestoreTimeoutMs}
                onChange={(e) =>
                  setConfigForm({
                    ...configForm,
                    firestoreTimeoutMs: Number(e.target.value)
                  })
                }
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer">
              <div>
                <p className="text-xs font-bold text-gray-800">Auto DB Failover</p>
                <p className="text-[11px] text-gray-500">Switch on timeout</p>
              </div>
              <input
                type="checkbox"
                checked={configForm.autoFailoverEnabled}
                onChange={(e) =>
                  setConfigForm({ ...configForm, autoFailoverEnabled: e.target.checked })
                }
                className="w-4 h-4 accent-blue-600 rounded"
              />
            </label>

            <label className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer">
              <div>
                <p className="text-xs font-bold text-gray-800">L1 RAM Cache</p>
                <p className="text-[11px] text-gray-500">Sub-ms node LRU</p>
              </div>
              <input
                type="checkbox"
                checked={configForm.l1CacheEnabled}
                onChange={(e) =>
                  setConfigForm({ ...configForm, l1CacheEnabled: e.target.checked })
                }
                className="w-4 h-4 accent-blue-600 rounded"
              />
            </label>

            <label className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer">
              <div>
                <p className="text-xs font-bold text-gray-800">Upstash L2 Cache</p>
                <p className="text-[11px] text-gray-500">Distributed Redis</p>
              </div>
              <input
                type="checkbox"
                checked={configForm.l2CacheEnabled}
                onChange={(e) =>
                  setConfigForm({ ...configForm, l2CacheEnabled: e.target.checked })
                }
                className="w-4 h-4 accent-blue-600 rounded"
              />
            </label>

            <label className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer">
              <div>
                <p className="text-xs font-bold text-gray-800">Supabase Sync</p>
                <p className="text-[11px] text-gray-500">Dual-write SQL archive</p>
              </div>
              <input
                type="checkbox"
                checked={configForm.archivalSyncEnabled}
                onChange={(e) =>
                  setConfigForm({ ...configForm, archivalSyncEnabled: e.target.checked })
                }
                className="w-4 h-4 accent-blue-600 rounded"
              />
            </label>
          </div>

          {configForm.lastFailoverEvent && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between gap-2">
              <span>
                <strong>Last Automatic Failover:</strong>{' '}
                {configForm.lastFailoverEvent.from} → {configForm.lastFailoverEvent.to} (
                {configForm.lastFailoverEvent.reason})
              </span>
              <span className="text-[11px] text-amber-700 font-mono">
                {new Date(configForm.lastFailoverEvent.at).toLocaleString()}
              </span>
            </div>
          )}

          {/* Direct DB Operations */}
          <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
            <button
              type="button"
              disabled={runningAction !== null}
              onClick={() => void handleRunAction('sync-snapshot')}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5"
            >
              <Zap size={14} />
              {runningAction === 'sync-snapshot'
                ? 'Syncing...'
                : 'Force Firestore → SQLite Snapshot Sync'}
            </button>
            <button
              type="button"
              disabled={runningAction !== null}
              onClick={() => void handleRunAction('purge-cache')}
              className="bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5"
            >
              <Trash2 size={14} />
              {runningAction === 'purge-cache' ? 'Purging...' : 'Purge L1 / L2 Caches'}
            </button>
            <button
              type="button"
              disabled={runningAction !== null}
              onClick={() => void handleRunAction('checkpoint-sqlite')}
              className="bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5"
            >
              <HardDrive size={14} />
              {runningAction === 'checkpoint-sqlite'
                ? 'Checkpointing...'
                : 'Run SQLite WAL Checkpoint'}
            </button>
            <button
              type="button"
              disabled={runningAction !== null}
              onClick={() => void handleRunAction('sync-supabase')}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5"
            >
              <ArrowRightLeft size={14} />
              {runningAction === 'sync-supabase'
                ? 'Syncing Supabase...'
                : 'Sync Archive ↔ Supabase Postgres'}
            </button>
          </div>
        </form>
      )}

      {/* Databases & Cloud Storage Cards with Storage Uses & Balance */}
      {loading && !report ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="bg-white rounded-2xl border border-gray-100 h-52 animate-pulse p-5" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {report?.databases.map((dbEntry) => {
            const pct =
              dbEntry.usedBytes !== null &&
              dbEntry.freeTierLimitBytes !== null &&
              dbEntry.freeTierLimitBytes > 0
                ? Math.min(100, Math.max(0.1, (dbEntry.usedBytes / dbEntry.freeTierLimitBytes) * 100))
                : null;

            return (
              <div
                key={dbEntry.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-xs p-5 flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          dbEntry.status === 'connected'
                            ? 'bg-green-50 text-green-600'
                            : dbEntry.status === 'degraded'
                            ? 'bg-red-50 text-red-600'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        <Database size={20} />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 text-sm">{dbEntry.name}</h3>
                        <p className="text-[11px] text-gray-500">{dbEntry.provider}</p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase inline-flex items-center gap-1 ${
                          dbEntry.status === 'connected'
                            ? 'bg-green-100 text-green-700'
                            : dbEntry.status === 'degraded'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {dbEntry.status === 'connected' && <CheckCircle2 size={10} />}
                        {dbEntry.status}
                      </span>
                      {dbEntry.latencyMs !== null && (
                        <p className="text-[10px] font-mono text-gray-400 mt-1">
                          {dbEntry.latencyMs} ms probe
                        </p>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-gray-600 mt-3">{dbEntry.role}</p>

                  {/* Storage Used & Balance Bar */}
                  <div className="mt-4 p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-500 font-medium">Used Storage / Load:</span>
                      <span className="font-bold text-gray-900">{dbEntry.usageLabel}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-500 font-medium">Available Balance:</span>
                      <span className="font-bold text-emerald-700">{dbEntry.balanceLabel}</span>
                    </div>
                    {pct !== null && (
                      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.max(1.5, pct)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {dbEntry.statusNote && (
                    <div className="mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-start gap-2">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
                      <span>{dbEntry.statusNote}</span>
                    </div>
                  )}
                </div>

                {/* Measured Details */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100 text-[11px]">
                  {Object.entries(dbEntry.details).map(([k, v]) => (
                    <div key={k} className="truncate">
                      <span className="text-gray-400 capitalize">
                        {k.replace(/([A-Z])/g, ' $1')}:{' '}
                      </span>
                      <span className="font-semibold text-gray-700">
                        {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v ?? '—')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-xs text-blue-900 flex items-start gap-2.5">
        <ShieldCheck size={18} className="shrink-0 text-blue-600 mt-0.5" />
        <p>
          All storage sizes, disk balances, row counts, and latencies shown above are measured directly from SQLite WAL (`edge_replica.db`), OS filesystem `statfs`, and live cloud REST probes without simulated figures. External metered credentials (`SUPABASE_URL`, `UPSTASH_REDIS_REST_URL`, `R2_*`) are configured via `.env` on the server host.
        </p>
      </div>
    </div>
  );
};
