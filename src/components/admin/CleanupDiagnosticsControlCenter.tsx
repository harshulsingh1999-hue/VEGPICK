import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Globe,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Wrench,
  Zap
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { adminApiFetch } from '../../lib/apiClient';
import {
  runClientDeviceAudit,
  runClientDeviceCleanup,
  type ClientDeviceAuditResult
} from '../../lib/appDiagnosticsClient';

interface CleanupStats {
  expiredL1Removed: number;
  rateBucketsCleared: number;
  oldTelemetryRowsRemoved: number;
  oldDiagnosticRowsRemoved: number;
  walBytesReclaimed: number;
  orphanProofsRemoved: number;
  bytesFreed: number;
  durationMs: number;
}

interface CleanupControlConfig {
  autoCleanupEnabled: boolean;
  intervalMinutes: number;
  pruneExpiredL1Cache: boolean;
  pruneExpiredRateBuckets: boolean;
  pruneOldUsageTelemetryDays: number;
  pruneOldDiagnosticsDays: number;
  checkpointSqliteWal: boolean;
  pruneOldProofUploadsDays: number;
  lastCleanupAt: string | null;
  lastCleanupMode: 'auto' | 'manual' | null;
  lastCleanupSummary: string | null;
  lastCleanupStats: CleanupStats | null;
  updatedAt: string;
}

interface AppDiagnosticsControlConfig {
  autoDiagnosticsEnabled: boolean;
  scanIntervalMinutes: number;
  autoSelfHealEnabled: boolean;
  monitorAndroid: boolean;
  monitorIos: boolean;
  monitorWeb: boolean;
  lastScanAt: string | null;
  lastScanMode: 'auto' | 'manual' | null;
  lastOverallStatus: 'healthy' | 'warning' | 'critical' | null;
  lastHealthScore: number | null;
  lastAutoHealsApplied: string[];
  updatedAt: string;
}

interface PlatformCheckItem {
  id: string;
  title: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  autoFixable: boolean;
}

interface PlatformDiagnosticsGroup {
  platform: 'android' | 'ios' | 'web' | 'security';
  label: string;
  monitored: boolean;
  status: 'healthy' | 'warning' | 'critical';
  passCount: number;
  warnCount: number;
  failCount: number;
  recentErrors24h: number;
  checks: PlatformCheckItem[];
}

interface DiagnosticEventRecord {
  id: string;
  platform: 'android' | 'ios' | 'web' | 'server';
  severity: 'info' | 'warning' | 'error';
  category: string;
  message: string;
  route: string;
  userAgent: string;
  resolved: boolean;
  autoHealed: boolean;
  createdAt: string;
}

interface CleanupInventory {
  l1Entries: number;
  expiredL1Entries: number;
  rateBucketEntries: number;
  expiredRateBucketEntries: number;
  walBytes: number;
  telemetryRows: number;
  diagnosticRows: number;
  unresolvedDiagnosticRows: number;
  totalUploadFiles: number;
  totalUploadBytes: number;
  proofUploadFiles: number;
  heapUsedBytes: number;
  heapLimitBytes: number;
}

interface MaintenanceOverviewResponse {
  ok: boolean;
  mode: 'auto' | 'manual';
  checkedAt: string;
  durationMs: number;
  overallStatus: 'healthy' | 'warning' | 'critical';
  score: number;
  autoHealsApplied: string[];
  controlConfig: AppDiagnosticsControlConfig;
  cleanupConfig: CleanupControlConfig;
  inventory: CleanupInventory;
  platforms: {
    android: PlatformDiagnosticsGroup;
    ios: PlatformDiagnosticsGroup;
    web: PlatformDiagnosticsGroup;
    security: PlatformDiagnosticsGroup;
  };
  recentEvents: DiagnosticEventRecord[];
  eventCounts: {
    android24h: number;
    ios24h: number;
    web24h: number;
    totalStored: number;
    unresolved: number;
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const CleanupDiagnosticsControlCenter: React.FC = () => {
  const { firebaseUser } = useAuth();
  const { showToast } = useToast();

  const [overview, setOverview] = useState<MaintenanceOverviewResponse | null>(null);
  const [cleanupForm, setCleanupForm] = useState<CleanupControlConfig | null>(null);
  const [diagForm, setDiagForm] = useState<AppDiagnosticsControlConfig | null>(null);
  const [deviceAudit, setDeviceAudit] = useState<ClientDeviceAuditResult | null>(null);

  const [loading, setLoading] = useState(true);
  const [runningCleanup, setRunningCleanup] = useState<string | null>(null);
  const [savingCleanup, setSavingCleanup] = useState(false);
  const [runningDiag, setRunningDiag] = useState<string | null>(null);
  const [savingDiag, setSavingDiag] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<'ALL' | 'android' | 'ios' | 'web' | 'server'>('ALL');

  const fetchOverview = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const [serverRes, localAudit] = await Promise.all([
        adminApiFetch('/api/admin/maintenance', token),
        runClientDeviceAudit().catch(() => null)
      ]);
      const data = await serverRes.json();
      if (!serverRes.ok) throw new Error(data.error || 'Failed to load CleanUp & App Diagnosis overview');
      const typed = data as MaintenanceOverviewResponse;
      setOverview(typed);
      setCleanupForm(typed.cleanupConfig);
      setDiagForm(typed.controlConfig);
      if (localAudit) setDeviceAudit(localAudit);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load CleanUp & Diagnosis overview', 'error');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, showToast]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const handleSaveCleanupConfig = async (nextCfg?: CleanupControlConfig) => {
    if (!firebaseUser) return;
    const payload = nextCfg || cleanupForm;
    if (!payload) return;
    setSavingCleanup(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await adminApiFetch('/api/admin/cleanup/config', token, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save Auto CleanUp settings');
      setCleanupForm(data.controlConfig as CleanupControlConfig);
      showToast(
        data.controlConfig.autoCleanupEnabled
          ? 'Auto CleanUp enabled & schedule saved!'
          : 'Auto CleanUp switched to Manual-Only mode.',
        'success'
      );
      void fetchOverview();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save CleanUp config', 'error');
    } finally {
      setSavingCleanup(false);
    }
  };

  const handleRunManualCleanup = async (
    variant: 'standard' | 'deep' | 'browser'
  ) => {
    if (!firebaseUser) return;
    setRunningCleanup(variant);
    try {
      if (variant === 'browser') {
        const clientResult = await runClientDeviceCleanup({ preserveAuth: true, resetClusterCache: false });
        const freshAudit = await runClientDeviceAudit();
        setDeviceAudit(freshAudit);
        showToast(clientResult.summary, 'success');
        return;
      }

      const token = await firebaseUser.getIdToken();
      const res = await adminApiFetch('/api/admin/cleanup/run', token, {
        method: 'POST',
        body: JSON.stringify({
          mode: 'manual',
          purgeAllL1: variant === 'deep',
          purgeL2Catalog: variant === 'deep'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'CleanUp run failed');
      showToast(data.summary || 'Server CleanUp completed cleanly.', 'success');
      void fetchOverview();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'CleanUp run failed', 'error');
    } finally {
      setRunningCleanup(null);
    }
  };

  const handleSaveDiagConfig = async (nextCfg?: AppDiagnosticsControlConfig) => {
    if (!firebaseUser) return;
    const payload = nextCfg || diagForm;
    if (!payload) return;
    setSavingDiag(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await adminApiFetch('/api/admin/diagnostics/config', token, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save App Diagnosis settings');
      setDiagForm(data.controlConfig as AppDiagnosticsControlConfig);
      showToast('Android + iOS + Web Auto Diagnosis & Self-Heal policy updated!', 'success');
      void fetchOverview();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save Diagnosis config', 'error');
    } finally {
      setSavingDiag(false);
    }
  };

  const handleRunDiagnosis = async (variant: 'scan' | 'heal' | 'device') => {
    if (!firebaseUser) return;
    setRunningDiag(variant);
    try {
      if (variant === 'device') {
        const freshAudit = await runClientDeviceAudit();
        setDeviceAudit(freshAudit);
        showToast(
          `Current ${freshAudit.platform.toUpperCase()} device scanned (${freshAudit.checks.filter((c) => c.status === 'pass').length}/${freshAudit.checks.length} checks passed).`,
          'success'
        );
        return;
      }

      const token = await firebaseUser.getIdToken();
      const res = await adminApiFetch('/api/admin/diagnostics/run', token, {
        method: 'POST',
        body: JSON.stringify({
          mode: 'manual',
          runSelfHeal: variant === 'heal'
        })
      });
      const data = (await res.json()) as MaintenanceOverviewResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Cross-platform diagnosis failed');
      setOverview(data);
      setCleanupForm(data.cleanupConfig);
      setDiagForm(data.controlConfig);

      const freshAudit = await runClientDeviceAudit().catch(() => null);
      if (freshAudit) setDeviceAudit(freshAudit);

      if (variant === 'heal') {
        const heals = data.autoHealsApplied || [];
        showToast(
          heals.length > 0
            ? `Auto-Heal applied ${heals.length} fix(es): ${heals[0]}`
            : `All Android, iOS & Web systems healthy (${data.score}% score).`,
          'success'
        );
      } else {
        showToast(
          `Android + iOS + Web Diagnosis complete: ${data.score}% health score (${data.overallStatus.toUpperCase()}).`,
          data.overallStatus === 'critical' ? 'error' : 'success'
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Diagnosis scan failed', 'error');
    } finally {
      setRunningDiag(null);
    }
  };

  const handleResolveEvents = async (target: string) => {
    if (!firebaseUser) return;
    setResolvingId(target);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await adminApiFetch('/api/admin/diagnostics/resolve', token, {
        method: 'POST',
        body: JSON.stringify({ target })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve diagnostic events');
      showToast(
        target === 'all'
          ? `Marked ${data.updated ?? 0} diagnostic alert(s) resolved.`
          : 'Alert marked resolved.',
        'success'
      );
      void fetchOverview();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Resolve failed', 'error');
    } finally {
      setResolvingId(null);
    }
  };

  const statusBadge = (status: 'healthy' | 'warning' | 'critical' | 'pass' | 'warn' | 'fail') => {
    if (status === 'healthy' || status === 'pass') {
      return 'bg-green-100 text-green-700 border-green-200';
    }
    if (status === 'warning' || status === 'warn') {
      return 'bg-amber-100 text-amber-800 border-amber-200';
    }
    return 'bg-red-100 text-red-700 border-red-200';
  };

  const filteredEvents = (overview?.recentEvents || []).filter((ev) =>
    eventFilter === 'ALL' ? true : ev.platform === eventFilter
  );

  if (loading && !overview) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center space-y-3">
        <RefreshCw size={28} className="animate-spin text-blue-600 mx-auto" />
        <p className="text-sm font-bold text-gray-700">
          Inspecting CleanUp inventory &amp; running Android + iOS + Web App Diagnosis...
        </p>
      </div>
    );
  }

  const inv = overview?.inventory;
  const platformsList = overview
    ? [
        overview.platforms.android,
        overview.platforms.ios,
        overview.platforms.web,
        overview.platforms.security
      ]
    : [];

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* Header & Top Quick Actions */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Wrench size={22} className="text-blue-600" />
            CleanUp &amp; Android + iOS + Web App Diagnosis
          </h2>
          <p className="text-sm text-gray-500">
            Automated background maintenance &amp; self-healing plus manual one-click CleanUp and cross-platform error protection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRunManualCleanup('standard')}
            disabled={runningCleanup !== null}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <Trash2 size={14} className={runningCleanup === 'standard' ? 'animate-pulse' : ''} />
            {runningCleanup === 'standard' ? 'Cleaning...' : 'Manual CleanUp'}
          </button>
          <button
            type="button"
            onClick={() => void handleRunDiagnosis('scan')}
            disabled={runningDiag !== null}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <Activity size={14} className={runningDiag === 'scan' ? 'animate-spin' : ''} />
            {runningDiag === 'scan' ? 'Diagnosing...' : 'Diagnose All Apps'}
          </button>
          <button
            type="button"
            onClick={() => void handleRunDiagnosis('heal')}
            disabled={runningDiag !== null}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <Sparkles size={14} className={runningDiag === 'heal' ? 'animate-pulse' : ''} />
            {runningDiag === 'heal' ? 'Healing...' : 'Auto-Heal Now'}
          </button>
          <button
            type="button"
            onClick={() => void fetchOverview()}
            disabled={loading}
            className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Top Health & Auto Protection Banner */}
      {overview && (
        <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-emerald-950 text-white rounded-2xl p-5 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
          <div>
            <p className="text-[11px] uppercase tracking-wider font-bold text-blue-300">
              Cross-Platform App Health
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-extrabold">{overview.score}%</span>
              <span
                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                  overview.overallStatus === 'healthy'
                    ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40'
                    : overview.overallStatus === 'warning'
                    ? 'bg-amber-500/20 text-amber-200 border-amber-400/40'
                    : 'bg-red-500/20 text-red-200 border-red-400/40'
                }`}
              >
                {overview.overallStatus}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-1">
              Last Scan: {new Date(overview.checkedAt).toLocaleTimeString()} ({overview.durationMs}ms)
            </p>
          </div>

          <div className="bg-white/10 rounded-xl p-3">
            <p className="text-[10px] uppercase font-bold text-emerald-300">CleanUp Mode</p>
            <p className="text-sm font-bold mt-0.5">
              {cleanupForm?.autoCleanupEnabled ? 'Auto + Manual Active' : 'Manual Control Only'}
            </p>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Schedule: Every {Math.round((cleanupForm?.intervalMinutes || 360) / 60)}h • Last:{' '}
              {cleanupForm?.lastCleanupAt
                ? `${cleanupForm.lastCleanupMode?.toUpperCase()} @ ${new Date(cleanupForm.lastCleanupAt).toLocaleTimeString()}`
                : 'Ready'}
            </p>
          </div>

          <div className="bg-white/10 rounded-xl p-3">
            <p className="text-[10px] uppercase font-bold text-blue-300">App Diagnosis &amp; Self-Heal</p>
            <p className="text-sm font-bold mt-0.5">
              {diagForm?.autoDiagnosticsEnabled ? 'Auto Guard + Manual' : 'Manual Scan Only'}
            </p>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Self-Heal: {diagForm?.autoSelfHealEnabled ? 'ON (Auto-Fix)' : 'OFF'} • Interval:{' '}
              {diagForm?.scanIntervalMinutes || 15}m
            </p>
          </div>

          <div className="bg-white/10 rounded-xl p-3">
            <p className="text-[10px] uppercase font-bold text-amber-300">24h Unresolved Errors</p>
            <p className="text-sm font-bold mt-0.5">
              {overview.eventCounts.unresolved} Active Alert(s)
            </p>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Android: {overview.eventCounts.android24h} • iOS: {overview.eventCounts.ios24h} • Web:{' '}
              {overview.eventCounts.web24h}
            </p>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SECTION 1: CLEANUP CONTROL CENTER (AUTO + MANUAL) */}
      {/* ================================================================= */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xs p-5 space-y-5">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-100 pb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Trash2 size={18} className="text-emerald-600" />
              System CleanUp Center (Auto &amp; Manual Control)
            </h3>
            <p className="text-xs text-gray-500">
              Keeps memory cache, API rate buckets, SQLite WAL journal, telemetry logs &amp; device caches lean and error-free.
            </p>
          </div>

          {cleanupForm && (
            <button
              type="button"
              onClick={() => {
                const toggled = {
                  ...cleanupForm,
                  autoCleanupEnabled: !cleanupForm.autoCleanupEnabled
                };
                setCleanupForm(toggled);
                void handleSaveCleanupConfig(toggled);
              }}
              disabled={savingCleanup}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                cleanupForm.autoCleanupEnabled
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Auto CleanUp: {cleanupForm.autoCleanupEnabled ? 'ON' : 'OFF (Manual)'}
            </button>
          )}
        </div>

        {/* Cleanable Inventory Metrics */}
        {inv && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-[10px] font-bold uppercase text-gray-500">L1 Memory Cache</p>
              <p className="text-lg font-extrabold text-gray-800">{inv.l1Entries}</p>
              <p className="text-[11px] text-gray-500">{inv.expiredL1Entries} expired</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-[10px] font-bold uppercase text-gray-500">Rate Buckets</p>
              <p className="text-lg font-extrabold text-gray-800">{inv.rateBucketEntries}</p>
              <p className="text-[11px] text-gray-500">{inv.expiredRateBucketEntries} expired</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-[10px] font-bold uppercase text-gray-500">SQLite WAL Size</p>
              <p className="text-lg font-extrabold text-gray-800">{formatBytes(inv.walBytes)}</p>
              <p className="text-[11px] text-gray-500">Checkpoint ready</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-[10px] font-bold uppercase text-gray-500">Telemetry &amp; Logs</p>
              <p className="text-lg font-extrabold text-gray-800">
                {inv.telemetryRows + inv.diagnosticRows}
              </p>
              <p className="text-[11px] text-gray-500">{inv.unresolvedDiagnosticRows} unresolved</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-[10px] font-bold uppercase text-gray-500">Local Media Store</p>
              <p className="text-lg font-extrabold text-gray-800">{formatBytes(inv.totalUploadBytes)}</p>
              <p className="text-[11px] text-gray-500">
                {inv.totalUploadFiles} files ({inv.proofUploadFiles} proof)
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-[10px] font-bold uppercase text-gray-500">Device CacheStorage</p>
              <p className="text-lg font-extrabold text-gray-800">
                {deviceAudit ? deviceAudit.cacheStorageCount : 0}
              </p>
              <p className="text-[11px] text-gray-500">
                {deviceAudit ? `${Math.round(deviceAudit.localStorageBytes / 1024)} KB local` : 'Scanning'}
              </p>
            </div>
          </div>
        )}

        {/* Auto Settings + Manual Actions Split */}
        {cleanupForm && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Auto CleanUp Policy Form */}
            <div className="bg-gray-50/80 border border-gray-200 rounded-2xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                  <Cpu size={15} className="text-emerald-600" />
                  Auto CleanUp Schedule &amp; Rules
                </h4>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  Background Scheduler
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-bold text-gray-600 mb-1">Auto CleanUp Interval</label>
                  <select
                    value={cleanupForm.intervalMinutes}
                    onChange={(e) =>
                      setCleanupForm({ ...cleanupForm, intervalMinutes: Number(e.target.value) })
                    }
                    className="w-full p-2.5 bg-white border border-gray-200 rounded-xl font-medium"
                  >
                    <option value={60}>Every 1 Hour</option>
                    <option value={360}>Every 6 Hours (Recommended)</option>
                    <option value={720}>Every 12 Hours</option>
                    <option value={1440}>Every 24 Hours</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-gray-600 mb-1">Prune Proof Photos After</label>
                  <select
                    value={cleanupForm.pruneOldProofUploadsDays}
                    onChange={(e) =>
                      setCleanupForm({
                        ...cleanupForm,
                        pruneOldProofUploadsDays: Number(e.target.value)
                      })
                    }
                    className="w-full p-2.5 bg-white border border-gray-200 rounded-xl font-medium"
                  >
                    <option value={0}>Keep All (Off — Safest)</option>
                    <option value={30}>Older than 30 Days</option>
                    <option value={60}>Older than 60 Days</option>
                    <option value={90}>Older than 90 Days</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-gray-600 mb-1">Keep API Usage Telemetry (Days)</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={cleanupForm.pruneOldUsageTelemetryDays}
                    onChange={(e) =>
                      setCleanupForm({
                        ...cleanupForm,
                        pruneOldUsageTelemetryDays: Math.max(1, Number(e.target.value) || 14)
                      })
                    }
                    className="w-full p-2.5 bg-white border border-gray-200 rounded-xl font-medium"
                  />
                </div>

                <div>
                  <label className="block font-bold text-gray-600 mb-1">Keep App Diagnostic Logs (Days)</label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={cleanupForm.pruneOldDiagnosticsDays}
                    onChange={(e) =>
                      setCleanupForm({
                        ...cleanupForm,
                        pruneOldDiagnosticsDays: Math.max(1, Number(e.target.value) || 7)
                      })
                    }
                    className="w-full p-2.5 bg-white border border-gray-200 rounded-xl font-medium"
                  />
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <label className="flex items-center gap-2 font-semibold text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cleanupForm.pruneExpiredL1Cache}
                    onChange={(e) =>
                      setCleanupForm({ ...cleanupForm, pruneExpiredL1Cache: e.target.checked })
                    }
                    className="w-4 h-4 accent-emerald-600 rounded"
                  />
                  Auto-sweep expired L1 RAM cache entries
                </label>
                <label className="flex items-center gap-2 font-semibold text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cleanupForm.pruneExpiredRateBuckets}
                    onChange={(e) =>
                      setCleanupForm({ ...cleanupForm, pruneExpiredRateBuckets: e.target.checked })
                    }
                    className="w-4 h-4 accent-emerald-600 rounded"
                  />
                  Auto-purge expired IP rate-limit buckets
                </label>
                <label className="flex items-center gap-2 font-semibold text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cleanupForm.checkpointSqliteWal}
                    onChange={(e) =>
                      setCleanupForm({ ...cleanupForm, checkpointSqliteWal: e.target.checked })
                    }
                    className="w-4 h-4 accent-emerald-600 rounded"
                  />
                  Auto-truncate SQLite WAL journal (reclaim disk &amp; lock safety)
                </label>
              </div>

              <button
                type="button"
                onClick={() => void handleSaveCleanupConfig()}
                disabled={savingCleanup}
                className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white py-2.5 rounded-xl text-xs font-bold"
              >
                {savingCleanup ? 'Saving Auto CleanUp Rules...' : 'Save Auto CleanUp Rules'}
              </button>
            </div>

            {/* Manual CleanUp Controls & Result */}
            <div className="bg-emerald-50/50 border border-emerald-200 rounded-2xl p-4 space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-emerald-950 flex items-center gap-1.5">
                  <Zap size={15} className="text-emerald-600" />
                  Manual CleanUp Controls (Instant Execution)
                </h4>
                <p className="text-xs text-emerald-900/80">
                  Run targeted cleanup manually anytime without disrupting logged-in shoppers, orders, or Firebase sessions.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => void handleRunManualCleanup('standard')}
                    disabled={runningCleanup !== null}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white p-3 rounded-xl text-left transition"
                  >
                    <p className="text-xs font-bold">Standard CleanUp</p>
                    <p className="text-[10px] text-emerald-100 mt-0.5">
                      Expired L1 + buckets + WAL + old logs
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleRunManualCleanup('deep')}
                    disabled={runningCleanup !== null}
                    className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white p-3 rounded-xl text-left transition"
                  >
                    <p className="text-xs font-bold">Deep Cache Purge</p>
                    <p className="text-[10px] text-slate-300 mt-0.5">
                      Flush all L1 + Upstash catalog + WAL
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleRunManualCleanup('browser')}
                    disabled={runningCleanup !== null}
                    className="bg-white hover:bg-gray-50 border border-emerald-300 disabled:opacity-50 text-emerald-900 p-3 rounded-xl text-left transition"
                  >
                    <p className="text-xs font-bold">Clean Browser Cache</p>
                    <p className="text-[10px] text-emerald-700 mt-0.5">
                      Clear CacheStorage (keeps login)
                    </p>
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-emerald-200 p-3 text-xs space-y-1">
                <p className="font-bold text-gray-800">Last CleanUp Report</p>
                {cleanupForm.lastCleanupSummary ? (
                  <>
                    <p className="text-emerald-800 font-medium">{cleanupForm.lastCleanupSummary}</p>
                    <p className="text-[11px] text-gray-500">
                      Mode: <strong className="uppercase">{cleanupForm.lastCleanupMode}</strong> • Ran:{' '}
                      {cleanupForm.lastCleanupAt
                        ? new Date(cleanupForm.lastCleanupAt).toLocaleString()
                        : 'Never'}
                    </p>
                  </>
                ) : (
                  <p className="text-gray-500">
                    No CleanUp executed yet — click Standard CleanUp or wait for Auto CleanUp scheduler.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* SECTION 2: ANDROID + IOS + WEB APP DIAGNOSIS (AUTO + MANUAL) */}
      {/* ================================================================= */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xs p-5 space-y-5">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-100 pb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <ShieldCheck size={18} className="text-blue-600" />
              App Diagnosis: Android + iOS + Web (Auto &amp; Manual Control)
            </h3>
            <p className="text-xs text-gray-500">
              Continuous health checks, PWA/Safe-Area verification, cross-platform error telemetry, and automated self-healing.
            </p>
          </div>

          {diagForm && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const toggled = {
                    ...diagForm,
                    autoDiagnosticsEnabled: !diagForm.autoDiagnosticsEnabled
                  };
                  setDiagForm(toggled);
                  void handleSaveDiagConfig(toggled);
                }}
                disabled={savingDiag}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition ${
                  diagForm.autoDiagnosticsEnabled
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Auto Diagnosis: {diagForm.autoDiagnosticsEnabled ? 'ON' : 'OFF (Manual)'}
              </button>

              <button
                type="button"
                onClick={() => {
                  const toggled = {
                    ...diagForm,
                    autoSelfHealEnabled: !diagForm.autoSelfHealEnabled
                  };
                  setDiagForm(toggled);
                  void handleSaveDiagConfig(toggled);
                }}
                disabled={savingDiag}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition ${
                  diagForm.autoSelfHealEnabled
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Auto Self-Heal: {diagForm.autoSelfHealEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          )}
        </div>

        {/* Auto Diagnosis Controls + Manual Scan Buttons */}
        {diagForm && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-gray-50/80 border border-gray-200 rounded-2xl p-4 space-y-3">
              <h4 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                <Activity size={15} className="text-blue-600" />
                Auto Diagnosis &amp; Platform Coverage Rules
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-bold text-gray-600 mb-1">Auto Scan Interval</label>
                  <select
                    value={diagForm.scanIntervalMinutes}
                    onChange={(e) =>
                      setDiagForm({ ...diagForm, scanIntervalMinutes: Number(e.target.value) })
                    }
                    className="w-full p-2.5 bg-white border border-gray-200 rounded-xl font-medium"
                  >
                    <option value={5}>Every 5 Minutes</option>
                    <option value={15}>Every 15 Minutes (Recommended)</option>
                    <option value={30}>Every 30 Minutes</option>
                    <option value={60}>Every 60 Minutes</option>
                  </select>
                </div>

                <div className="flex flex-col justify-end space-y-1.5 pb-1">
                  <label className="flex items-center gap-2 font-semibold text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={diagForm.monitorAndroid}
                      onChange={(e) => setDiagForm({ ...diagForm, monitorAndroid: e.target.checked })}
                      className="w-4 h-4 accent-blue-600 rounded"
                    />
                    Monitor Android App
                  </label>
                  <label className="flex items-center gap-2 font-semibold text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={diagForm.monitorIos}
                      onChange={(e) => setDiagForm({ ...diagForm, monitorIos: e.target.checked })}
                      className="w-4 h-4 accent-blue-600 rounded"
                    />
                    Monitor iOS App
                  </label>
                  <label className="flex items-center gap-2 font-semibold text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={diagForm.monitorWeb}
                      onChange={(e) => setDiagForm({ ...diagForm, monitorWeb: e.target.checked })}
                      className="w-4 h-4 accent-blue-600 rounded"
                    />
                    Monitor Web App
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleSaveDiagConfig()}
                disabled={savingDiag}
                className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white py-2.5 rounded-xl text-xs font-bold"
              >
                {savingDiag ? 'Saving Diagnosis Policy...' : 'Save Auto Diagnosis & Self-Heal Rules'}
              </button>
            </div>

            <div className="bg-blue-50/50 border border-blue-200 rounded-2xl p-4 space-y-3 flex flex-col justify-between">
              <div className="space-y-2.5">
                <h4 className="text-sm font-bold text-blue-950 flex items-center gap-1.5">
                  <Wrench size={15} className="text-blue-600" />
                  Manual Cross-Platform Diagnosis Controls
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => void handleRunDiagnosis('scan')}
                    disabled={runningDiag !== null}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white p-3 rounded-xl text-left transition"
                  >
                    <p className="text-xs font-bold">Full Scan</p>
                    <p className="text-[10px] text-blue-100 mt-0.5">Android + iOS + Web + DBs</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleRunDiagnosis('heal')}
                    disabled={runningDiag !== null}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white p-3 rounded-xl text-left transition"
                  >
                    <p className="text-xs font-bold">Diagnose &amp; Heal</p>
                    <p className="text-[10px] text-indigo-100 mt-0.5">Auto-fix snapshots &amp; cache</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleRunDiagnosis('device')}
                    disabled={runningDiag !== null}
                    className="bg-white hover:bg-gray-50 border border-blue-300 disabled:opacity-50 text-blue-900 p-3 rounded-xl text-left transition"
                  >
                    <p className="text-xs font-bold">Test This Device</p>
                    <p className="text-[10px] text-blue-700 mt-0.5">Live OS, PWA &amp; safe-area check</p>
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-blue-200 p-3 text-xs">
                <p className="font-bold text-gray-800">Last Auto-Heal Actions</p>
                {overview?.autoHealsApplied && overview.autoHealsApplied.length > 0 ? (
                  <ul className="list-disc list-inside text-indigo-800 mt-1 space-y-0.5">
                    {overview.autoHealsApplied.map((h, idx) => (
                      <li key={idx}>{h}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-500 mt-0.5">
                    No repairs needed — all 4 failover servers, snapshots &amp; platform checks are healthy.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 4 Platform Health Cards: Android, iOS, Web, Security */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {platformsList.map((group) => {
            const Icon =
              group.platform === 'android' || group.platform === 'ios'
                ? Smartphone
                : group.platform === 'web'
                ? Globe
                : ShieldCheck;

            return (
              <div
                key={group.platform}
                className="rounded-2xl border border-gray-200 bg-gray-50/50 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-800">
                      <Icon size={18} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-gray-800">{group.label}</h4>
                      <p className="text-[11px] text-gray-500">
                        {group.passCount} Pass • {group.warnCount} Warn • {group.failCount} Fail •{' '}
                        {group.recentErrors24h} Unresolved (24h)
                      </p>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full border ${statusBadge(
                      group.status
                    )}`}
                  >
                    {group.status}
                  </span>
                </div>

                <div className="space-y-2">
                  {group.checks.map((chk) => (
                    <div
                      key={chk.id}
                      className="bg-white rounded-xl border border-gray-100 p-2.5 flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-800">{chk.title}</p>
                        <p className="text-[11px] text-gray-500 break-words">{chk.detail}</p>
                      </div>
                      <span
                        className={`shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${statusBadge(
                          chk.status
                        )}`}
                      >
                        {chk.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Live Current Device Audit */}
        {deviceAudit && (
          <div className="bg-slate-900 text-white rounded-2xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
              <div>
                <h4 className="text-sm font-bold flex items-center gap-2">
                  <HardDrive size={15} className="text-emerald-400" />
                  Live On-Device Inspection (This Browser / App Session)
                </h4>
                <p className="text-[11px] text-slate-300">
                  Detected OS: <strong className="uppercase text-emerald-300">{deviceAudit.platform}</strong> • Viewport:{' '}
                  {deviceAudit.viewport} • Mode:{' '}
                  {deviceAudit.standaloneMode ? 'Installed PWA' : 'Browser Tab'} • Service Worker:{' '}
                  {deviceAudit.serviceWorkerState}
                </p>
              </div>
              <span className="text-[11px] font-bold bg-white/10 px-2.5 py-1 rounded-lg">
                API Latency: {deviceAudit.apiHealthLatencyMs !== null ? `${deviceAudit.apiHealthLatencyMs}ms` : 'N/A'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {deviceAudit.checks.map((chk) => (
                <div key={chk.id} className="bg-white/10 rounded-xl p-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-bold text-white truncate">{chk.label}</span>
                    {chk.status === 'pass' ? (
                      <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                    )}
                  </div>
                  <p className="text-[10px] text-slate-300">{chk.detail}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* SECTION 3: LIVE ERROR GUARD & SELF-HEAL EVENT LOG */}
      {/* ================================================================= */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xs p-5 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h3 className="text-base font-bold text-gray-800">
              Cross-Platform Runtime Error Guard &amp; Self-Heal Log
            </h3>
            <p className="text-xs text-gray-500">
              Real uncaught exceptions, chunk-load recoveries, and auto-heal operations across Android, iOS, Web &amp; Express Server.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(['ALL', 'android', 'ios', 'web', 'server'] as const).map((plat) => (
              <button
                key={plat}
                type="button"
                onClick={() => setEventFilter(plat)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase transition ${
                  eventFilter === plat
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {plat}
              </button>
            ))}

            <button
              type="button"
              onClick={() => void handleResolveEvents('all')}
              disabled={resolvingId !== null}
              className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 px-3 py-1.5 rounded-lg text-[11px] font-bold"
            >
              Mark All Resolved
            </button>
          </div>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-6 text-center space-y-1">
            <CheckCircle2 size={24} className="text-emerald-600 mx-auto" />
            <p className="text-sm font-bold text-emerald-900">Zero Captured Runtime Errors</p>
            <p className="text-xs text-emerald-700">
              Android, iOS, and Web global ErrorBoundary &amp; Promise guards are actively protecting users.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-[10px] uppercase text-gray-500">
                  <th className="py-2 pr-3">Platform</th>
                  <th className="py-2 pr-3">Severity</th>
                  <th className="py-2 pr-3">Category / Route</th>
                  <th className="py-2 pr-3">Message</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredEvents.map((ev) => (
                  <tr key={ev.id} className="hover:bg-gray-50/70">
                    <td className="py-2.5 pr-3 font-bold uppercase text-gray-800">{ev.platform}</td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                          ev.severity === 'error'
                            ? 'bg-red-100 text-red-700 border-red-200'
                            : ev.severity === 'warning'
                            ? 'bg-amber-100 text-amber-800 border-amber-200'
                            : 'bg-blue-100 text-blue-700 border-blue-200'
                        }`}
                      >
                        {ev.severity}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <p className="font-semibold text-gray-800">{ev.category}</p>
                      <p className="text-[10px] text-gray-500">{ev.route || '/'}</p>
                    </td>
                    <td className="py-2.5 pr-3 max-w-md">
                      <p className="text-gray-700 break-words">{ev.message}</p>
                      <p className="text-[10px] text-gray-400">
                        {new Date(ev.createdAt).toLocaleString()}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3">
                      {ev.autoHealed ? (
                        <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-[10px] font-bold">
                          Auto-Healed
                        </span>
                      ) : ev.resolved ? (
                        <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-[10px] font-bold">
                          Resolved
                        </span>
                      ) : (
                        <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-[10px] font-bold">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      {!ev.resolved && (
                        <button
                          type="button"
                          onClick={() => void handleResolveEvents(ev.id)}
                          disabled={resolvingId === ev.id}
                          className="text-blue-600 hover:text-blue-800 font-bold text-[11px]"
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
