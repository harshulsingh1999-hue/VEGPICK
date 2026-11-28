import React, { useEffect, useState } from 'react';
import { Bell, BellRing, CheckCircle2, Smartphone, X } from 'lucide-react';
import {
  AppPushRole,
  detectAppPlatformCapabilities,
  dispatchAppPushNotification,
  enableAndSubscribePush,
  getNotificationPermissionState,
  syncExistingPushSubscription
} from '../lib/pushNotifications';
import { useToast } from '../context/ToastContext';

interface PushPermissionBannerProps {
  role: AppPushRole;
  theme?: 'light' | 'dark';
  compact?: boolean;
}

export const PushPermissionBanner: React.FC<PushPermissionBannerProps> = ({
  role,
  theme = 'light',
  compact = false
}) => {
  const { showToast } = useToast();
  const [caps] = useState(() => detectAppPlatformCapabilities());
  const [permission, setPermission] = useState(() => getNotificationPermissionState());
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setPermission(getNotificationPermissionState());
    if (getNotificationPermissionState() === 'granted') {
      void syncExistingPushSubscription(role);
    }
  }, [role]);

  if (dismissed) return null;

  const isDark = theme === 'dark';
  const platformTag = caps.isAndroid ? 'Android' : caps.isIOS ? 'iOS' : 'Web';

  const handleEnable = async () => {
    setBusy(true);
    try {
      const res = await enableAndSubscribePush({ role, sendTest: true });
      setPermission(res.permission);
      if (res.ok) {
        showToast(res.message, 'success');
      } else {
        showToast(res.message, 'info');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTestPush = async () => {
    setBusy(true);
    try {
      await syncExistingPushSubscription(role);
      await dispatchAppPushNotification({
        title:
          role === 'delivery'
            ? 'FreshVeggie Rider Push Alert'
            : role === 'admin'
            ? 'FreshVeggie Admin Push Alert'
            : 'FreshVeggie Order Push Alert',
        body: `Push notifications are working on your ${platformTag} device!`,
        url:
          role === 'delivery'
            ? '/delivery/dashboard'
            : role === 'admin'
            ? '/admin/dashboard'
            : '/orders',
        tag: `test-push-${role}`,
        eventType: 'self',
        targetRoles: [],
        showLocally: true
      });
      showToast(`Sent test push notification to this ${platformTag} device`, 'success');
    } finally {
      setBusy(false);
    }
  };

  const handleDelayedBackgroundTest = async () => {
    setBusy(true);
    try {
      await syncExistingPushSubscription(role);
      await dispatchAppPushNotification({
        title: 'FreshVeggie Background Push',
        body: `Delivered in background to your ${platformTag} device without Firebase ID token!`,
        url:
          role === 'delivery'
            ? '/delivery/dashboard'
            : role === 'admin'
            ? '/admin/dashboard'
            : '/orders',
        tag: `bg-test-push-${role}`,
        eventType: 'self',
        delaySeconds: 5,
        showLocally: false
      });
      showToast('Background Web Push scheduled (5s) — minimize app now to test!', 'info');
    } finally {
      setBusy(false);
    }
  };

  if (permission === 'granted') {
    if (compact) return null;
    return (
      <div
        className={`rounded-xl border px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs ${
          isDark
            ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-200'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 size={15} className={isDark ? 'text-emerald-400 shrink-0' : 'text-emerald-600 shrink-0'} />
          <span className="font-semibold">
            Background Push Active ({platformTag}
            {caps.isStandalone ? ' PWA' : ''})
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={handleDelayedBackgroundTest}
            className={`px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50 ${
              isDark
                ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/30'
                : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-200'
            }`}
          >
            Bg Test (5s)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleTestPush}
            className={`px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50 ${
              isDark
                ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30'
                : 'bg-white hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
            }`}
          >
            {busy ? 'Sending...' : 'Test Push'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
        isDark
          ? 'bg-gray-800 border-blue-500/30 text-gray-200'
          : 'bg-blue-50 border-blue-200 text-blue-900'
      }`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
            isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-600 text-white'
          }`}
        >
          {caps.iosNeedsHomeScreen ? <Smartphone size={16} /> : <BellRing size={16} />}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-sm">
            {caps.iosNeedsHomeScreen
              ? 'Enable iOS Push Notifications'
              : permission === 'denied'
              ? `Notifications Blocked on ${platformTag}`
              : `Enable Push Notifications (${platformTag})`}
          </p>
          <p className={`text-[11px] mt-0.5 ${isDark ? 'text-gray-400' : 'text-blue-700'}`}>
            {caps.iosNeedsHomeScreen
              ? 'On iPhone/iPad, tap Safari Share -> Add to Home Screen, then launch the app to receive iOS Push Notifications.'
              : permission === 'denied'
              ? 'Open device/browser site settings and set Notifications to Allow to receive real-time alerts.'
              : role === 'delivery'
              ? 'Get every new order request, status alert, and location sync reminder via Push Notifications.'
              : 'Receive every order update, dispatch status, and store alert via Push Notifications.'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {!caps.iosNeedsHomeScreen && permission !== 'denied' && (
          <button
            type="button"
            disabled={busy}
            onClick={handleEnable}
            className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-50 transition"
          >
            <Bell size={14} />
            {busy ? 'Enabling...' : 'Allow Push Alerts'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className={`p-1.5 rounded-lg ${
            isDark ? 'text-gray-400 hover:bg-gray-700' : 'text-blue-500 hover:bg-blue-100'
          }`}
          aria-label="Dismiss notification prompt"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
};
