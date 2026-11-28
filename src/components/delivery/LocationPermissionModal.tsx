import React, { useEffect, useState } from 'react';
import {
  BellRing,
  Copy,
  ExternalLink,
  MapPin,
  RefreshCw,
  Settings2,
  Smartphone,
  X
} from 'lucide-react';
import {
  DEVICE_LOCATION_STEPS,
  DeviceOsType,
  detectDeviceOs,
  getBrowserLocationSettingsCopyUrl,
  inspectGeolocationPermission,
  openDeviceLocationSettingsDirectly
} from '../../lib/locationPermission';
import {
  enableAndSubscribePush,
  getNotificationPermissionState,
  sendLocationPermissionPushReminder
} from '../../lib/pushNotifications';
import { useToast } from '../../context/ToastContext';

interface LocationPermissionModalProps {
  open: boolean;
  onClose: () => void;
  onRetrySync: () => void;
  orderId?: string;
  targetRoute: string;
}

export const LocationPermissionModal: React.FC<LocationPermissionModalProps> = ({
  open,
  onClose,
  onRetrySync,
  orderId,
  targetRoute
}) => {
  const { showToast } = useToast();
  const [selectedOs, setSelectedOs] = useState<DeviceOsType>(() => detectDeviceOs());
  const [sendingPush, setSendingPush] = useState(false);

  // Auto-detect when partner returns from Device Settings and sync immediately
  useEffect(() => {
    if (!open) return undefined;
    const handleReturnFromSettings = async () => {
      if (document.visibilityState === 'hidden') return;
      const state = await inspectGeolocationPermission();
      if (state === 'granted') {
        onClose();
        onRetrySync();
      }
    };
    window.addEventListener('focus', handleReturnFromSettings);
    document.addEventListener('visibilitychange', handleReturnFromSettings);
    return () => {
      window.removeEventListener('focus', handleReturnFromSettings);
      document.removeEventListener('visibilitychange', handleReturnFromSettings);
    };
  }, [open, onClose, onRetrySync]);

  if (!open) return null;

  const guide = DEVICE_LOCATION_STEPS[selectedOs];
  const pushPermission = getNotificationPermissionState();
  const browserSettingsUrl = getBrowserLocationSettingsCopyUrl();

  const handleOpenDeviceSettings = (mode: 'location_source' | 'app_details' = 'location_source') => {
    const launch = openDeviceLocationSettingsDirectly(mode);
    if (launch.launchedNative) {
      showToast('Opening device Location Settings — allow location and return here.', 'info');
      return;
    }

    if (selectedOs === 'desktop' && browserSettingsUrl && navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(browserSettingsUrl)
        .then(() => {
          showToast(`Copied ${browserSettingsUrl} — paste into a new tab to allow Location.`, 'info');
        })
        .catch(() => {
          showToast('Click the tune/lock icon beside the address bar -> Location -> Allow.', 'info');
        });
      return;
    }

    if (selectedOs === 'ios') {
      showToast(
        'Open iPhone Settings -> Privacy & Security -> Location Services -> While Using the App.',
        'info'
      );
      return;
    }

    showToast('Open Device Settings -> Location / App Permissions -> Allow Location.', 'info');
  };

  const handleCopyBrowserUrl = async () => {
    const urlToCopy = browserSettingsUrl || 'chrome://settings/content/location';
    try {
      await navigator.clipboard.writeText(urlToCopy);
      showToast(`Copied ${urlToCopy} — open in browser address bar to allow Location.`, 'success');
    } catch {
      showToast(`Open ${urlToCopy} in your browser address bar.`, 'info');
    }
  };

  const handleSendLocationPush = async () => {
    setSendingPush(true);
    try {
      if (pushPermission !== 'granted') {
        const sub = await enableAndSubscribePush({ role: 'delivery', sendTest: false });
        if (!sub.ok) {
          showToast(sub.message, 'info');
          return;
        }
      }
      const res = await sendLocationPermissionPushReminder({
        url: targetRoute,
        orderId
      });
      if (res.shownLocally || res.sentRemote) {
        showToast(
          'Location permission Push Notification sent! Tap it anytime after allowing Location.',
          'success'
        );
      } else {
        showToast('Could not display push notification on this browser context.', 'info');
      }
    } finally {
      setSendingPush(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800 border border-gray-700 text-white rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 border-b border-gray-700 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <Settings2 size={20} />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">
                Device Location Permission Settings
              </h3>
              <p className="text-xs text-gray-400">
                Allow Location permission in device settings — no extra verification needed.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:bg-gray-700 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Direct Quick Launch Buttons */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => handleOpenDeviceSettings('location_source')}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition"
          >
            <ExternalLink size={16} />
            Open Device Location Settings
          </button>

          {selectedOs === 'android' && (
            <button
              type="button"
              onClick={() => handleOpenDeviceSettings('app_details')}
              className="w-full py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-100 font-bold text-xs flex items-center justify-center gap-2 border border-gray-600 transition"
            >
              <Smartphone size={15} />
              Open Android App Permissions
            </button>
          )}

          {selectedOs === 'desktop' && browserSettingsUrl && (
            <button
              type="button"
              onClick={handleCopyBrowserUrl}
              className="w-full py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-100 font-bold text-xs flex items-center justify-center gap-2 border border-gray-600 transition"
            >
              <Copy size={14} />
              Copy Browser Location Settings ({browserSettingsUrl})
            </button>
          )}
        </div>

        {/* OS Selector Tabs */}
        <div className="grid grid-cols-3 gap-1.5 bg-gray-900 p-1 rounded-xl border border-gray-700">
          {(
            [
              { id: 'android', label: 'Android' },
              { id: 'ios', label: 'iPhone / iPad' },
              { id: 'desktop', label: 'Web Browser' }
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedOs(item.id)}
              className={`py-2 rounded-lg text-xs font-bold transition ${
                selectedOs === item.id
                  ? 'bg-green-600 text-white shadow-xs'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Device Settings Steps */}
        <div className="bg-gray-900/80 border border-gray-700 rounded-xl p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-green-400">
            <Smartphone size={14} />
            <span>{guide.title}</span>
          </div>
          <p className="text-[11px] text-gray-400">{guide.subtitle}</p>
          <ol className="space-y-2 text-xs text-gray-200">
            {guide.steps.map((stepText, idx) => (
              <li key={idx} className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-gray-700 text-green-400 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <span className="leading-relaxed">{stepText}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Secondary Action Buttons */}
        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={() => {
              onClose();
              onRetrySync();
            }}
            className="w-full py-2.5 rounded-xl bg-green-600/20 hover:bg-green-600/30 border border-green-500/40 text-green-300 font-bold text-xs flex items-center justify-center gap-2 transition"
          >
            <RefreshCw size={15} />
            Allow / Retry Sync Now
          </button>

          <button
            type="button"
            disabled={sendingPush}
            onClick={handleSendLocationPush}
            className="w-full py-2.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 font-bold text-xs flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            <BellRing size={15} />
            {sendingPush
              ? 'Sending Push Notification...'
              : 'Send Push Notification Shortcut'}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white flex items-center justify-center gap-1"
          >
            <MapPin size={13} /> Close
          </button>
        </div>
      </div>
    </div>
  );
};
