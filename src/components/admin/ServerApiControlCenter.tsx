import React, { useState, useEffect, useCallback } from 'react';
import {
  Server,
  Globe,
  Activity,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Clock,
  Gauge,
  ShieldCheck,
  Zap,
  RotateCcw
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { adminApiFetch, syncRuntimeServerNodes } from '../../lib/apiClient';

interface ServerNodeConfig {
  id: string;
  label: string;
  url: string;
  region: string;
  role: 'primary' | 'secondary' | 'edge-worker';
  tier?: 'primary' | 'backup';
  freeUnlimited?: boolean;
  enabled: boolean;
  priority: number;
}

interface ServerDailyQuotas {
  serverDailyQuota: number;
  quoteDailyQuota: number;
  verifyStockDailyQuota: number;
  uploadDailyQuota: number;
  bootstrapDailyQuota: number;
  firestoreReadsDailyQuota: number;
  upstashDailyQuota: number;
  authDailyQuota: number;
}

interface ServerControlConfig {
  serverNodes: ServerNodeConfig[];
  catalogTtlSeconds: number;
  slotsTtlSeconds: number;
  quoteTtlSeconds: number;
  rateLimits: {
    uploadPerMin: number;
    verifyStockPerMin: number;
    quotePerMin: number;
    archivePerMin: number;
    invalidatePerMin: number;
  };
  dailyQuotas: ServerDailyQuotas;
  autoServerFailover: boolean;
  unlimitedFreeMode?: boolean;
  updatedAt: string;
}

interface NodeQuotaDetail {
  nodeId: string;
  label: string;
  role: string;
  tier?: string;
  enabled: boolean;
  isUnlimited?: boolean;
  quotaTier: string;
  dailyQuota: number;
  usedToday: number;
  remainingToday: number;
}

interface ServerQuotaSummary {
  serverRequestsDailyQuota: number;
  serverRequestsUsedToday: number;
  serverRequestsRemainingToday: number;
  serverRequestsLastMin: number;
  serverPerMinCapacity: number;
  protectedUsedThisMin: number;
  protectedRemainingThisMin: number;
  serverThrottledToday: number;
  serverErrorsToday: number;
  unlimitedFreeMode?: boolean;
  cacheHitsToday: number;
  l1Hits: number;
  l2Hits: number;
  cacheMisses: number;
  cacheOffloadPercent: number;
  nodeQuotas: NodeQuotaDetail[];
}

interface QuoteApiQuota {
  rateLimitPerMin: number;
  usedThisMin: number;
  remainingThisMin: number;
  dailyQuota: number;
  usedToday: number;
  remainingToday: number;
  cacheHitsToday: number;
  throttledToday: number;
  errorCountToday: number;
  avgLatencyMs: number;
  lastCalledAt: string | null;
  cacheTtlSeconds: number;
}

interface ApiRegistryItem {
  id: string;
  group: string;
  method: string;
  path: string;
  targetUrl: string;
  auth: string;
  rateLimit: string;
  cacheTtl: string;
  description: string;
  perMinLimit: number | null;
  usedThisMin: number;
  remainingThisMin: number | null;
  dailyQuota: number | null;
  usedToday: number;
  remainingToday: number | null;
  cacheHitsToday: number;
  throttledToday: number;
  errorCountToday: number;
  avgLatencyMs: number;
  lastCalledAt: string | null;
}

interface ServersReportResponse {
  controlConfig: ServerControlConfig;
  runtime: {
    nodeVersion: string;
    platform: string;
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapLimitBytes?: number;
    heapRemainingBytes?: number;
    replicaId: string;
    region: string;
    cloudflareWorkerTemplate: string;
    dayKey?: string;
    quotaResetInSeconds?: number;
    clusterSummary?: {
      architecture: string;
      primaryServers: number;
      backupServers: number;
      freeAndUnlimited: boolean;
      autoServerFailover: boolean;
    };
  };
  serverQuotaSummary: ServerQuotaSummary;
  quoteApiQuota: QuoteApiQuota;
  apiRegistry: ApiRegistryItem[];
}

interface ProbeOutcome {
  ok: boolean;
  status: number;
  latencyMs: number;
  cacheHeader?: string | null;
  edgeHeader?: string | null;
  error?: string;
}

const DEFAULT_DAILY_QUOTAS: ServerDailyQuotas = {
  serverDailyQuota: 10000000,
  quoteDailyQuota: 5000000,
  verifyStockDailyQuota: 5000000,
  uploadDailyQuota: 1000000,
  bootstrapDailyQuota: 10000000,
  firestoreReadsDailyQuota: 5000000,
  upstashDailyQuota: 1000000,
  authDailyQuota: 5000000
};

export const ServerApiControlCenter: React.FC = () => {
  const { firebaseUser } = useAuth();
  const { showToast } = useToast();

  const [report, setReport] = useState<ServersReportResponse | null>(null);
  const [configForm, setConfigForm] = useState<ServerControlConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resettingUsage, setResettingUsage] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [probingTarget, setProbingTarget] = useState<string | null>(null);
  const [probingAll, setProbingAll] = useState(false);
  const [probeResults, setProbeResults] = useState<Record<string, ProbeOutcome>>({});
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingNodeUrl, setEditingNodeUrl] = useState('');

  const [newNodeLabel, setNewNodeLabel] = useState('');
  const [newNodeUrl, setNewNodeUrl] = useState('');
  const [newNodeRole, setNewNodeRole] = useState<'primary' | 'secondary' | 'edge-worker'>('edge-worker');

  const normalizeConfig = (cfg: ServerControlConfig): ServerControlConfig => ({
    ...cfg,
    unlimitedFreeMode: cfg.unlimitedFreeMode !== false,
    dailyQuotas: {
      ...DEFAULT_DAILY_QUOTAS,
      ...(cfg.dailyQuotas || {})
    }
  });

  const fetchReport = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await adminApiFetch('/api/admin/servers', token);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load server telemetry');
      const typed = data as ServersReportResponse;
      setReport(typed);
      setConfigForm(normalizeConfig(typed.controlConfig));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load servers', 'error');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, showToast]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  const saveConfig = async (nextConfig: ServerControlConfig) => {
    if (!firebaseUser) return;
    setSaving(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await adminApiFetch('/api/admin/servers/config', token, {
        method: 'POST',
        body: JSON.stringify(nextConfig)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save server configuration');
      const updated = normalizeConfig(data.controlConfig as ServerControlConfig);
      setConfigForm(updated);
      syncRuntimeServerNodes(updated.serverNodes, updated.autoServerFailover);
      showToast('Server failover cluster, quotas, rate limits & TTLs updated!', 'success');
      void fetchReport();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to update server config', 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetQuotaUsage = async () => {
    if (!firebaseUser) return;
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 5000);
      return;
    }
    setResettingUsage(true);
    setConfirmReset(false);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await adminApiFetch('/api/admin/servers/reset-usage', token, {
        method: 'POST',
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset usage counters');
      showToast('Daily server & API quota usage counters reset!', 'success');
      await fetchReport();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to reset usage counters', 'error');
    } finally {
      setResettingUsage(false);
    }
  };

  const runProbe = async (target: string) => {
    if (!firebaseUser) return;
    setProbingTarget(target);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await adminApiFetch('/api/admin/servers/probe', token, {
        method: 'POST',
        body: JSON.stringify({ target })
      });
      const data = (await res.json()) as ProbeOutcome;
      setProbeResults((prev) => ({ ...prev, [target]: data }));
      showToast(
        data.ok
          ? `Probe OK (${data.status}) in ${data.latencyMs} ms`
          : `Probe failed (${data.status}): ${data.error || 'Unreachable'}`,
        data.ok ? 'success' : 'error'
      );
      void fetchReport();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Probe error', 'error');
    } finally {
      setProbingTarget(null);
    }
  };

  const probeAllClusterNodes = async () => {
    if (!firebaseUser || !configForm) return;
    setProbingAll(true);
    try {
      const token = await firebaseUser.getIdToken();
      const outcomes = await Promise.all(
        configForm.serverNodes.map(async (node) => {
          const res = await adminApiFetch('/api/admin/servers/probe', token, {
            method: 'POST',
            body: JSON.stringify({ target: node.id })
          });
          const data = (await res.json()) as ProbeOutcome;
          return [node.id, data] as const;
        })
      );
      setProbeResults((prev) => {
        const next = { ...prev };
        for (const [id, data] of outcomes) {
          next[id] = data;
        }
        return next;
      });
      const healthyCount = outcomes.filter(([, d]) => d.ok).length;
      showToast(
        `Cluster Health Check: ${healthyCount}/${outcomes.length} servers responding online!`,
        healthyCount === outcomes.length ? 'success' : 'error'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Cluster probe failed', 'error');
    } finally {
      setProbingAll(false);
    }
  };

  const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const formatCountdown = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '24h 0m';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs}h ${mins}m`;
  };

  const getUsageBarColor = (used: number, limit: number) => {
    if (!limit || limit <= 0) return 'bg-emerald-500';
    const pct = (used / limit) * 100;
    if (pct >= 85) return 'bg-red-500';
    if (pct >= 60) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  const getPercentUsed = (used: number, limit: number | null) => {
    if (!limit || limit <= 0) return 0;
    return Math.min(100, Math.round((used / limit) * 1000) / 10);
  };

  const groups = ['ALL', ...Array.from(new Set((report?.apiRegistry || []).map((a) => a.group)))];
  const filteredApis = (report?.apiRegistry || []).filter(
    (api) => selectedGroup === 'ALL' || api.group === selectedGroup
  );

  const summary = report?.serverQuotaSummary;
  const quoteQuota = report?.quoteApiQuota;
  const heapUsed = report?.runtime.heapUsedBytes || 0;
  const heapLimit = report?.runtime.heapLimitBytes || Math.max(heapUsed, 1);
  const heapRemaining = report?.runtime.heapRemainingBytes ?? Math.max(0, heapLimit - heapUsed);
  const heapPctUsed = Math.min(100, Math.round((heapUsed / heapLimit) * 1000) / 10);

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Server &amp; API Control Center</h2>
          <p className="text-sm text-gray-500">
            Monitor server &amp; Order Quote API quotas, live request uses, remaining balances, failover nodes, rate limits, and cache TTLs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void resetQuotaUsage()}
            disabled={resettingUsage}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition ${
              confirmReset
                ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <RotateCcw size={14} className={resettingUsage ? 'animate-spin' : ''} />
            {resettingUsage ? 'Resetting...' : confirmReset ? 'Confirm Reset Usage?' : "Reset Today's Usage"}
          </button>
          <button
            type="button"
            onClick={() => void fetchReport()}
            disabled={loading}
            className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh Telemetry
          </button>
        </div>
      </div>

      {/* Live Node Runtime & Heap Quota Cards */}
      {report && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-xs">
            <span className="text-[11px] font-bold text-gray-400 uppercase flex items-center gap-1">
              <Cpu size={13} /> Runtime Engine
            </span>
            <p className="text-base font-extrabold text-gray-900 mt-1.5">{report.runtime.nodeVersion}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{report.runtime.platform}</p>
            {report.runtime.dayKey && (
              <p className="text-[10px] text-gray-400 mt-1 font-mono">UTC Window: {report.runtime.dayKey}</p>
            )}
          </div>

          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-xs">
            <span className="text-[11px] font-bold text-gray-400 uppercase flex items-center gap-1">
              <Clock size={13} /> Process Uptime &amp; Reset
            </span>
            <p className="text-base font-extrabold text-green-600 mt-1.5">
              {Math.floor(report.runtime.uptimeSeconds / 60)}m {report.runtime.uptimeSeconds % 60}s
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Replica: {report.runtime.replicaId}
            </p>
            <p className="text-[10px] text-blue-600 font-semibold mt-1">
              Quota reset in {formatCountdown(report.runtime.quotaResetInSeconds)}
            </p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-xs">
            <span className="text-[11px] font-bold text-gray-400 uppercase flex items-center gap-1">
              <Activity size={13} /> Server Heap Quota &amp; Balance
            </span>
            <p className="text-base font-extrabold text-gray-900 mt-1.5">
              {formatMb(heapUsed)}{' '}
              <span className="text-xs font-semibold text-gray-400">/ {formatMb(heapLimit)}</span>
            </p>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1.5">
              <div
                className={`h-full rounded-full ${getUsageBarColor(heapUsed, heapLimit)}`}
                style={{ width: `${Math.max(2, heapPctUsed)}%` }}
              />
            </div>
            <p className="text-[11px] text-emerald-700 font-semibold mt-1">
              Balance: {formatMb(heapRemaining)} ({(100 - heapPctUsed).toFixed(1)}% free)
            </p>
            <p className="text-[10px] text-gray-400">RSS Total: {formatMb(report.runtime.rssBytes)}</p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-xs">
            <span className="text-[11px] font-bold text-gray-400 uppercase flex items-center gap-1">
              <Globe size={13} /> Edge &amp; Region
            </span>
            <p className="text-base font-extrabold text-blue-600 mt-1.5">{report.runtime.region}</p>
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">
              Worker: {report.runtime.cloudflareWorkerTemplate}
            </p>
            <p className="text-[10px] text-emerald-700 font-semibold mt-1">
              Edge Tier: 100,000 req/day Free
            </p>
          </div>
        </div>
      )}

      {/* Server Quota, Order Quote API & Per-Minute Request Budget Section */}
      {summary && quoteQuota && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xs p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Gauge size={18} />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 text-base">
                  Server Quota, API Request Budget &amp; Order Quote Telemetry
                </h3>
                <p className="text-xs text-gray-500">
                  Real-time server quota limits, live uses, remaining balance, Order Quote API throughput, and cache offload savings.
                </p>
              </div>
            </div>
            <span className="text-[11px] font-mono bg-gray-100 text-gray-700 px-2.5 py-1 rounded-lg font-semibold">
              {summary.serverRequestsLastMin} req / current min
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* 1. Server Daily Quota Card */}
            <div className="p-4 rounded-xl border border-emerald-100 bg-emerald-50/40 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase text-emerald-800">
                  Server Daily Request Quota
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                  {getPercentUsed(summary.serverRequestsUsedToday, summary.serverRequestsDailyQuota)}% used
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center bg-white/90 rounded-lg p-2 border border-emerald-100">
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">Quota</p>
                  <p className="text-xs font-extrabold text-gray-900">
                    {summary.serverRequestsDailyQuota.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">Used</p>
                  <p className="text-xs font-extrabold text-blue-700">
                    {summary.serverRequestsUsedToday.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">Balance</p>
                  <p className="text-xs font-extrabold text-emerald-700">
                    {summary.serverRequestsRemainingToday.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="w-full h-2 bg-white rounded-full overflow-hidden border border-emerald-100">
                <div
                  className={`h-full rounded-full ${getUsageBarColor(
                    summary.serverRequestsUsedToday,
                    summary.serverRequestsDailyQuota
                  )}`}
                  style={{
                    width: `${Math.max(
                      2,
                      getPercentUsed(summary.serverRequestsUsedToday, summary.serverRequestsDailyQuota)
                    )}%`
                  }}
                />
              </div>
              <p className="text-[11px] text-gray-600 flex justify-between">
                <span>Active Window: {summary.serverRequestsLastMin}/min</span>
                <span>Throttled: {summary.serverThrottledToday}</span>
              </p>
            </div>

            {/* 2. Order Quote API (/api/orders/quote) Dedicated Quota & Balance Card */}
            <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/40 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase text-blue-800">
                  Order Quote API (/orders/quote)
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                  {quoteQuota.rateLimitPerMin}/min cap
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center bg-white/90 rounded-lg p-2 border border-blue-100">
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">Daily Limit</p>
                  <p className="text-xs font-extrabold text-gray-900">
                    {quoteQuota.dailyQuota.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">Uses</p>
                  <p className="text-xs font-extrabold text-blue-700">
                    {quoteQuota.usedToday.toLocaleString()} ({quoteQuota.usedThisMin}/m)
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">Balance</p>
                  <p className="text-xs font-extrabold text-emerald-700">
                    {quoteQuota.remainingToday.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="w-full h-2 bg-white rounded-full overflow-hidden border border-blue-100">
                <div
                  className={`h-full rounded-full ${getUsageBarColor(
                    quoteQuota.usedToday,
                    quoteQuota.dailyQuota
                  )}`}
                  style={{
                    width: `${Math.max(
                      2,
                      getPercentUsed(quoteQuota.usedToday, quoteQuota.dailyQuota)
                    )}%`
                  }}
                />
              </div>
              <p className="text-[11px] text-gray-600 flex justify-between">
                <span>
                  Min Balance: <strong>{quoteQuota.remainingThisMin}/{quoteQuota.rateLimitPerMin}</strong>
                </span>
                <span>
                  TTL: {quoteQuota.cacheTtlSeconds}s • {quoteQuota.avgLatencyMs}ms avg
                </span>
              </p>
            </div>

            {/* 3. Protected APIs Per-Min Capacity & Balance */}
            <div className="p-4 rounded-xl border border-amber-100 bg-amber-50/40 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase text-amber-800 flex items-center gap-1">
                  <ShieldCheck size={13} /> Rate-Limited Capacity (/min)
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                  {getPercentUsed(summary.protectedUsedThisMin, summary.serverPerMinCapacity)}% load
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center bg-white/90 rounded-lg p-2 border border-amber-100">
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">Limit/Min</p>
                  <p className="text-xs font-extrabold text-gray-900">
                    {summary.serverPerMinCapacity.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">Used/Min</p>
                  <p className="text-xs font-extrabold text-amber-700">
                    {summary.protectedUsedThisMin.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">Balance</p>
                  <p className="text-xs font-extrabold text-emerald-700">
                    {summary.protectedRemainingThisMin.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="w-full h-2 bg-white rounded-full overflow-hidden border border-amber-100">
                <div
                  className={`h-full rounded-full ${getUsageBarColor(
                    summary.protectedUsedThisMin,
                    summary.serverPerMinCapacity
                  )}`}
                  style={{
                    width: `${Math.max(
                      2,
                      getPercentUsed(summary.protectedUsedThisMin, summary.serverPerMinCapacity)
                    )}%`
                  }}
                />
              </div>
              <p className="text-[11px] text-gray-600 flex justify-between">
                <span>429 Blocked Today: {summary.serverThrottledToday}</span>
                <span>5xx Errors: {summary.serverErrorsToday}</span>
              </p>
            </div>

            {/* 4. Cache Offload & Free-Tier Protection */}
            <div className="p-4 rounded-xl border border-purple-100 bg-purple-50/40 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase text-purple-800 flex items-center gap-1">
                  <Zap size={13} /> Cache Quota Offload
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-800">
                  {summary.cacheOffloadPercent}% Offloaded
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center bg-white/90 rounded-lg p-2 border border-purple-100">
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">L1 Hits</p>
                  <p className="text-xs font-extrabold text-purple-700">
                    {summary.l1Hits.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">L2 Hits</p>
                  <p className="text-xs font-extrabold text-blue-700">
                    {summary.l2Hits.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">Misses</p>
                  <p className="text-xs font-extrabold text-gray-700">
                    {summary.cacheMisses.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="w-full h-2 bg-white rounded-full overflow-hidden border border-purple-100">
                <div
                  className="h-full rounded-full bg-purple-500"
                  style={{ width: `${Math.max(4, summary.cacheOffloadPercent)}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-600 flex justify-between">
                <span>Total Cache Hits: {summary.cacheHitsToday.toLocaleString()}</span>
                <span>DB Reads Saved</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Connected 2-Primary + 2-Backup Free & Unlimited Failover Cluster */}
      {configForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xs p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-gray-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <Server size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-gray-800 text-base">
                    2 Primary + 2 Backup Server Cluster
                  </h3>
                  <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    Free &amp; Unlimited
                  </span>
                  {report?.runtime.clusterSummary && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      {report.runtime.clusterSummary.architecture}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Traffic load-balances across Primary Server 1 &amp; Primary Server 2 and fails over automatically to Backup Server 3 &amp; Backup Server 4 with zero quota lockouts.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={probingAll}
                onClick={() => void probeAllClusterNodes()}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white flex items-center gap-1.5"
              >
                <Activity size={13} className={probingAll ? 'animate-pulse' : ''} />
                {probingAll ? 'Checking 4 Servers...' : 'Ping All 4 Servers'}
              </button>

              <label className="flex items-center gap-2 text-xs font-bold text-emerald-800 bg-emerald-50 px-3 py-2 rounded-xl border border-emerald-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={configForm.unlimitedFreeMode !== false}
                  onChange={(e) => {
                    const next = { ...configForm, unlimitedFreeMode: e.target.checked };
                    setConfigForm(next);
                    void saveConfig(next);
                  }}
                  className="w-4 h-4 accent-emerald-600 rounded"
                />
                Free &amp; Unlimited Mode
              </label>

              <label className="flex items-center gap-2 text-xs font-bold text-gray-700 bg-gray-50 px-3 py-2 rounded-xl border border-gray-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={configForm.autoServerFailover}
                  onChange={(e) => {
                    const next = { ...configForm, autoServerFailover: e.target.checked };
                    setConfigForm(next);
                    void saveConfig(next);
                  }}
                  className="w-4 h-4 accent-blue-600 rounded"
                />
                Auto Failover
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {configForm.serverNodes.map((node) => {
              const probe = probeResults[node.id];
              const nodeQuota = summary?.nodeQuotas.find((nq) => nq.nodeId === node.id);
              const isPrimaryTier = node.tier === 'primary' || node.role === 'primary';
              const isProtectedClusterNode = [
                'primary-server-1',
                'primary-server-2',
                'backup-server-3',
                'backup-server-4',
                'origin-primary'
              ].includes(node.id);
              const isEditingThis = editingNodeId === node.id;

              return (
                <div
                  key={node.id}
                  className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                    isPrimaryTier
                      ? 'border-blue-100 bg-blue-50/30'
                      : 'border-amber-100 bg-amber-50/30'
                  }`}
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded text-white ${
                            isPrimaryTier ? 'bg-blue-700' : 'bg-amber-600'
                          }`}
                        >
                          {isPrimaryTier ? `PRIMARY #${node.priority}` : `BACKUP #${node.priority}`}
                        </span>
                        <span className="font-bold text-sm text-gray-900">{node.label}</span>
                      </div>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
                        Free • Unlimited
                      </span>
                    </div>

                    {isEditingThis ? (
                      <div className="flex items-center gap-1.5 pt-1">
                        <input
                          type="text"
                          value={editingNodeUrl}
                          onChange={(e) => setEditingNodeUrl(e.target.value)}
                          placeholder="Leave blank for Same-Origin HA, or https://..."
                          className="flex-1 p-2 bg-white border border-gray-300 rounded-lg text-xs font-mono outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const clean = editingNodeUrl.trim().replace(/\/+$/, '');
                            if (clean && !/^https?:\/\//i.test(clean)) {
                              showToast('URL must start with https:// or http:// (or leave blank for same-origin)', 'error');
                              return;
                            }
                            const nextNodes = configForm.serverNodes.map((n) =>
                              n.id === node.id ? { ...n, url: clean } : n
                            );
                            const next = { ...configForm, serverNodes: nextNodes };
                            setConfigForm(next);
                            setEditingNodeId(null);
                            void saveConfig(next);
                          }}
                          className="px-2.5 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingNodeId(null)}
                          className="px-2 py-2 rounded-lg bg-gray-200 text-gray-700 text-xs font-bold"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs font-mono text-gray-600 truncate">
                        {node.url ||
                          (isPrimaryTier
                            ? 'Same-Origin Express HA Pool (Port 3000 • Zero Cost)'
                            : 'Cloud Failover & Local Resilient Standby (Zero Cost)')}
                      </p>
                    )}

                    {nodeQuota && (
                      <div className="pt-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                          <span className="text-gray-500 font-semibold">{nodeQuota.quotaTier}</span>
                          <span className="text-blue-700 font-bold">
                            Served: {nodeQuota.usedToday.toLocaleString()}
                          </span>
                          <span className="text-emerald-700 font-bold">
                            Quota: {nodeQuota.isUnlimited ? '∞ Unlimited' : `${nodeQuota.dailyQuota.toLocaleString()}/day`}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-white/80 rounded-full overflow-hidden border border-gray-200">
                          <div className="h-full rounded-full bg-emerald-500 w-full" />
                        </div>
                      </div>
                    )}

                    {probe && (
                      <p
                        className={`text-[11px] font-semibold flex items-center gap-1 ${
                          probe.ok ? 'text-green-700' : 'text-red-600'
                        }`}
                      >
                        {probe.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                        HTTP {probe.status} • {probe.latencyMs} ms
                        {probe.error ? ` (${probe.error})` : ''}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200/70">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingNodeId(node.id);
                        setEditingNodeUrl(node.url || '');
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white border border-gray-200 hover:bg-gray-100 text-gray-700"
                    >
                      Set URL
                    </button>

                    <button
                      type="button"
                      disabled={probingTarget === node.id}
                      onClick={() => void runProbe(node.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-gray-200 hover:bg-gray-100 text-gray-700"
                    >
                      {probingTarget === node.id ? 'Pinging...' : 'Ping Node'}
                    </button>

                    <button
                      type="button"
                      disabled={node.id === 'primary-server-1' || node.id === 'origin-primary'}
                      onClick={() => {
                        const nextNodes = configForm.serverNodes.map((n) =>
                          n.id === node.id ? { ...n, enabled: !n.enabled } : n
                        );
                        const next = { ...configForm, serverNodes: nextNodes };
                        setConfigForm(next);
                        void saveConfig(next);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                        node.enabled
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-200 text-gray-600'
                      } disabled:opacity-60`}
                    >
                      {node.enabled ? 'Active' : 'Paused'}
                    </button>

                    {!isProtectedClusterNode && (
                      <button
                        type="button"
                        onClick={() => {
                          const nextNodes = configForm.serverNodes.filter((n) => n.id !== node.id);
                          const next = { ...configForm, serverNodes: nextNodes };
                          setConfigForm(next);
                          void saveConfig(next);
                        }}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                        title="Remove Server Node"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add Extra Primary or Backup Origin / Cloudflare Worker */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const cleanUrl = newNodeUrl.trim().replace(/\/+$/, '');
              if (!/^https?:\/\//i.test(cleanUrl)) {
                showToast('Server URL must start with https:// or http://', 'error');
                return;
              }
              const nextNode: ServerNodeConfig = {
                id: `node_${Date.now().toString(36)}`,
                label: newNodeLabel.trim() || 'Extra Backup Server',
                url: cleanUrl,
                region: 'global-edge',
                role: newNodeRole,
                tier: newNodeRole === 'primary' ? 'primary' : 'backup',
                freeUnlimited: true,
                enabled: true,
                priority: configForm.serverNodes.length + 1
              };
              const next = {
                ...configForm,
                serverNodes: [...configForm.serverNodes, nextNode]
              };
              setConfigForm(next);
              setNewNodeLabel('');
              setNewNodeUrl('');
              void saveConfig(next);
            }}
            className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-2 border-t border-gray-100"
          >
            <input
              type="text"
              placeholder="Extra Server Label (Optional)"
              value={newNodeLabel}
              onChange={(e) => setNewNodeLabel(e.target.value)}
              className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none"
            />
            <input
              type="url"
              required
              placeholder="https://extra-server.example.com"
              value={newNodeUrl}
              onChange={(e) => setNewNodeUrl(e.target.value)}
              className="sm:col-span-2 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono outline-none"
            />
            <select
              value={newNodeRole}
              onChange={(e) => setNewNodeRole(e.target.value as 'primary' | 'secondary' | 'edge-worker')}
              className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none"
            >
              <option value="primary">Primary Origin Server</option>
              <option value="edge-worker">Cloudflare Edge Backup</option>
              <option value="secondary">Backup Origin Server</option>
            </select>
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl py-2.5 px-3 flex items-center justify-center gap-1"
            >
              <Plus size={14} /> Add Server
            </button>
          </form>
        </div>
      )}

      {/* Runtime Rate Limits, Daily Quotas & Edge Cache TTL Tuning */}
      {configForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveConfig(configForm);
          }}
          className="bg-white rounded-2xl border border-gray-100 shadow-xs p-5 space-y-5"
        >
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b border-gray-100 pb-3">
            <div>
              <h3 className="font-bold text-gray-800 text-base">
                API Quotas, Rate Limits &amp; Edge Cache TTL Controls
              </h3>
              <p className="text-xs text-gray-500">
                Tune per-IP protection limits (requests/min), 24-hour server &amp; API quotas, and L1/L2/CDN cache TTLs live.
              </p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold shrink-0"
            >
              {saving ? 'Saving...' : 'Save Quotas & Policies'}
            </button>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">
              Per-Minute Rate Limits &amp; Cache TTLs
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Catalog Cache TTL (sec)
                </label>
                <input
                  type="number"
                  min={5}
                  max={3600}
                  value={configForm.catalogTtlSeconds}
                  onChange={(e) =>
                    setConfigForm({ ...configForm, catalogTtlSeconds: Number(e.target.value) })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Delivery Slots TTL (sec)
                </label>
                <input
                  type="number"
                  min={5}
                  max={3600}
                  value={configForm.slotsTtlSeconds}
                  onChange={(e) =>
                    setConfigForm({ ...configForm, slotsTtlSeconds: Number(e.target.value) })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Order Quote TTL (sec)
                </label>
                <input
                  type="number"
                  min={5}
                  max={3600}
                  value={configForm.quoteTtlSeconds}
                  onChange={(e) =>
                    setConfigForm({ ...configForm, quoteTtlSeconds: Number(e.target.value) })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Verify-Stock Limit (/min)
                </label>
                <input
                  type="number"
                  min={10}
                  max={5000}
                  value={configForm.rateLimits.verifyStockPerMin}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      rateLimits: {
                        ...configForm.rateLimits,
                        verifyStockPerMin: Number(e.target.value)
                      }
                    })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Order Quote Limit (/min)
                </label>
                <input
                  type="number"
                  min={10}
                  max={5000}
                  value={configForm.rateLimits.quotePerMin}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      rateLimits: {
                        ...configForm.rateLimits,
                        quotePerMin: Number(e.target.value)
                      }
                    })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Media Upload Limit (/min)
                </label>
                <input
                  type="number"
                  min={5}
                  max={1000}
                  value={configForm.rateLimits.uploadPerMin}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      rateLimits: {
                        ...configForm.rateLimits,
                        uploadPerMin: Number(e.target.value)
                      }
                    })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  SQL Archive Limit (/min)
                </label>
                <input
                  type="number"
                  min={10}
                  max={5000}
                  value={configForm.rateLimits.archivePerMin}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      rateLimits: {
                        ...configForm.rateLimits,
                        archivePerMin: Number(e.target.value)
                      }
                    })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Cache Invalidate (/min)
                </label>
                <input
                  type="number"
                  min={5}
                  max={1000}
                  value={configForm.rateLimits.invalidatePerMin}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      rateLimits: {
                        ...configForm.rateLimits,
                        invalidatePerMin: Number(e.target.value)
                      }
                    })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">
              Daily Server &amp; API Quotas (24h UTC Budget)
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Server Daily Quota (req/day)
                </label>
                <input
                  type="number"
                  min={1000}
                  max={50000000}
                  value={configForm.dailyQuotas.serverDailyQuota}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      dailyQuotas: {
                        ...configForm.dailyQuotas,
                        serverDailyQuota: Number(e.target.value)
                      }
                    })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Order Quote API Quota (/day)
                </label>
                <input
                  type="number"
                  min={500}
                  max={10000000}
                  value={configForm.dailyQuotas.quoteDailyQuota}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      dailyQuotas: {
                        ...configForm.dailyQuotas,
                        quoteDailyQuota: Number(e.target.value)
                      }
                    })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Verify Stock Quota (/day)
                </label>
                <input
                  type="number"
                  min={500}
                  max={10000000}
                  value={configForm.dailyQuotas.verifyStockDailyQuota}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      dailyQuotas: {
                        ...configForm.dailyQuotas,
                        verifyStockDailyQuota: Number(e.target.value)
                      }
                    })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Catalog Bootstrap Quota (/day)
                </label>
                <input
                  type="number"
                  min={1000}
                  max={50000000}
                  value={configForm.dailyQuotas.bootstrapDailyQuota}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      dailyQuotas: {
                        ...configForm.dailyQuotas,
                        bootstrapDailyQuota: Number(e.target.value)
                      }
                    })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Media Upload Quota (/day)
                </label>
                <input
                  type="number"
                  min={100}
                  max={5000000}
                  value={configForm.dailyQuotas.uploadDailyQuota}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      dailyQuotas: {
                        ...configForm.dailyQuotas,
                        uploadDailyQuota: Number(e.target.value)
                      }
                    })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Firestore Reads Quota (/day)
                </label>
                <input
                  type="number"
                  min={1000}
                  max={10000000}
                  value={configForm.dailyQuotas.firestoreReadsDailyQuota}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      dailyQuotas: {
                        ...configForm.dailyQuotas,
                        firestoreReadsDailyQuota: Number(e.target.value)
                      }
                    })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Firebase Auth Quota (/day)
                </label>
                <input
                  type="number"
                  min={1000}
                  max={10000000}
                  value={configForm.dailyQuotas.authDailyQuota}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      dailyQuotas: {
                        ...configForm.dailyQuotas,
                        authDailyQuota: Number(e.target.value)
                      }
                    })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Upstash Cache Quota (/day)
                </label>
                <input
                  type="number"
                  min={1000}
                  max={10000000}
                  value={configForm.dailyQuotas.upstashDailyQuota}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      dailyQuotas: {
                        ...configForm.dailyQuotas,
                        upstashDailyQuota: Number(e.target.value)
                      }
                    })
                  }
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none"
                />
              </div>
            </div>
          </div>
        </form>
      )}

      {/* Complete Connected APIs Table with Quotas, Live Uses & Remaining Balances */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-gray-800 text-base">
              Connected Backend &amp; Cloud APIs ({filteredApis.length})
            </h3>
            <p className="text-xs text-gray-500">
              Live request quotas, per-minute limits, daily uses, remaining balances, cache hits, and average latency per endpoint.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {groups.map((grp) => (
              <button
                key={grp}
                type="button"
                onClick={() => setSelectedGroup(grp)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                  selectedGroup === grp
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {grp === 'ALL' ? 'All APIs' : grp}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-gray-600">
            <thead className="bg-gray-50 text-[11px] uppercase text-gray-400 font-bold border-b border-gray-100">
              <tr>
                <th className="p-3.5">Method &amp; Endpoint</th>
                <th className="p-3.5">Group &amp; Purpose</th>
                <th className="p-3.5">Quota &amp; Limit</th>
                <th className="p-3.5">Live Uses</th>
                <th className="p-3.5">Remaining Balance</th>
                <th className="p-3.5 text-right">Live Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredApis.map((api) => {
                const probe = probeResults[api.id];
                const isTestable = Boolean(api.targetUrl);
                const dailyPctUsed = getPercentUsed(api.usedToday, api.dailyQuota);
                return (
                  <tr key={api.id} className="hover:bg-gray-50/70 transition align-top">
                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] shrink-0 ${
                            api.method === 'GET'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {api.method}
                        </span>
                        <span className="font-mono font-bold text-gray-900">{api.path}</span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1">{api.auth}</p>
                    </td>

                    <td className="p-3.5 max-w-xs">
                      <p className="font-bold text-gray-800">{api.group}</p>
                      <p className="text-gray-500 mt-0.5">{api.description}</p>
                      <p className="text-[10px] text-gray-400 mt-1">TTL: {api.cacheTtl}</p>
                    </td>

                    <td className="p-3.5 whitespace-nowrap">
                      <p className="font-bold text-gray-800">
                        {api.perMinLimit !== null ? `${api.perMinLimit} req/min` : api.rateLimit}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        Daily:{' '}
                        <span className="font-semibold text-gray-700">
                          {api.dailyQuota !== null ? api.dailyQuota.toLocaleString() : 'Unlimited'}
                        </span>
                      </p>
                    </td>

                    <td className="p-3.5 whitespace-nowrap">
                      <p className="font-bold text-blue-700">
                        {api.usedToday.toLocaleString()} today
                      </p>
                      <p className="text-[11px] text-gray-600 mt-0.5">
                        {api.usedThisMin}/min • {api.avgLatencyMs}ms avg
                      </p>
                      {(api.cacheHitsToday > 0 || api.throttledToday > 0) && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          Cache Hits: {api.cacheHitsToday} • 429: {api.throttledToday}
                        </p>
                      )}
                    </td>

                    <td className="p-3.5 min-w-[165px]">
                      {api.remainingToday !== null && api.dailyQuota !== null ? (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-extrabold text-emerald-700">
                              {api.remainingToday.toLocaleString()} left
                            </span>
                            <span className="text-[10px] font-bold text-gray-400">
                              {(100 - dailyPctUsed).toFixed(1)}%
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${getUsageBarColor(
                                api.usedToday,
                                api.dailyQuota
                              )}`}
                              style={{ width: `${Math.max(2, dailyPctUsed)}%` }}
                            />
                          </div>
                          {api.remainingThisMin !== null && api.perMinLimit !== null && (
                            <p className="text-[10px] font-semibold text-gray-600">
                              Min Balance: {api.remainingThisMin}/{api.perMinLimit}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-gray-400">Unlimited</span>
                      )}
                    </td>

                    <td className="p-3.5 text-right whitespace-nowrap">
                      {isTestable ? (
                        <div className="inline-flex flex-col items-end gap-1">
                          <button
                            type="button"
                            disabled={probingTarget === api.id}
                            onClick={() => void runProbe(api.id)}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold px-2.5 py-1 rounded-lg text-[11px]"
                          >
                            {probingTarget === api.id ? 'Testing...' : 'Test Endpoint'}
                          </button>
                          {probe && (
                            <span
                              className={`text-[10px] font-mono font-bold ${
                                probe.ok ? 'text-green-600' : 'text-red-600'
                              }`}
                            >
                              {probe.status} • {probe.latencyMs} ms
                              {probe.cacheHeader ? ` (${probe.cacheHeader})` : ''}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-gray-400 italic">POST Mutation</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
