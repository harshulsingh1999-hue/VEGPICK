export type DeviceOsType = 'android' | 'ios' | 'desktop';
export type GeoPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';
export type BrowserEngineType = 'chrome' | 'edge' | 'firefox' | 'safari' | 'samsung' | 'other';

interface NativeSettingsWindow extends Window {
  Android?: { openLocationSettings?: () => void };
  AndroidInterface?: { openLocationSettings?: () => void };
  webkit?: {
    messageHandlers?: {
      openLocationSettings?: { postMessage?: (msg: unknown) => void };
    };
  };
  cordova?: {
    plugins?: {
      settings?: { open?: (target: string, onOk?: () => void, onErr?: () => void) => void };
    };
  };
}

export function detectDeviceOs(): DeviceOsType {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  ) {
    return 'ios';
  }
  return 'desktop';
}

export function detectBrowserEngine(): BrowserEngineType {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent.toLowerCase();
  if (/edg\//.test(ua) || /edga\//.test(ua) || /edgios\//.test(ua)) return 'edge';
  if (/samsungbrowser\//.test(ua)) return 'samsung';
  if (/firefox\//.test(ua) || /fxios\//.test(ua)) return 'firefox';
  if (/chrome\//.test(ua) || /crios\//.test(ua)) return 'chrome';
  if (/safari\//.test(ua)) return 'safari';
  return 'other';
}

export function getBrowserLocationSettingsCopyUrl(): string | null {
  const engine = detectBrowserEngine();
  if (engine === 'chrome') return 'chrome://settings/content/location';
  if (engine === 'edge') return 'edge://settings/content/location';
  if (engine === 'firefox') return 'about:preferences#privacy';
  return null;
}

export async function inspectGeolocationPermission(): Promise<GeoPermissionState> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return 'unsupported';
  }
  if (!navigator.permissions?.query) {
    return 'prompt';
  }
  try {
    const status = await navigator.permissions.query({
      name: 'geolocation' as PermissionName
    });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
    }
    return 'prompt';
  } catch {
    return 'prompt';
  }
}

export function subscribeGeolocationPermissionChange(
  onChange: (state: GeoPermissionState) => void
): () => void {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    onChange('unsupported');
    return () => undefined;
  }
  if (!navigator.permissions?.query) {
    onChange('prompt');
    return () => undefined;
  }

  let disposed = false;
  let permStatus: PermissionStatus | null = null;
  const handleStatusChange = () => {
    if (disposed || !permStatus) return;
    if (
      permStatus.state === 'granted' ||
      permStatus.state === 'denied' ||
      permStatus.state === 'prompt'
    ) {
      onChange(permStatus.state);
    }
  };

  navigator.permissions
    .query({ name: 'geolocation' as PermissionName })
    .then((status) => {
      if (disposed) return;
      permStatus = status;
      handleStatusChange();
      status.addEventListener('change', handleStatusChange);
    })
    .catch(() => {
      if (!disposed) onChange('prompt');
    });

  return () => {
    disposed = true;
    if (permStatus) {
      permStatus.removeEventListener('change', handleStatusChange);
    }
  };
}

export interface DirectSettingsLaunchResult {
  launchedNative: boolean;
  method: 'native-bridge' | 'android-intent' | 'ios-app-settings' | 'settings-panel';
  os: DeviceOsType;
}

/**
 * Synchronously attempts to open the device's Location Permission Settings
 * inside the user's click gesture without waiting for GPS or verification checks.
 */
export function openDeviceLocationSettingsDirectly(
  mode: 'location_source' | 'app_details' = 'location_source'
): DirectSettingsLaunchResult {
  const os = detectDeviceOs();
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { launchedNative: false, method: 'settings-panel', os };
  }

  const w = window as NativeSettingsWindow;

  // 1. Native Android / iOS WebView / TWA / Cordova bridges if running inside an app wrapper
  try {
    if (typeof w.Android?.openLocationSettings === 'function') {
      w.Android.openLocationSettings();
      return { launchedNative: true, method: 'native-bridge', os };
    }
    if (typeof w.AndroidInterface?.openLocationSettings === 'function') {
      w.AndroidInterface.openLocationSettings();
      return { launchedNative: true, method: 'native-bridge', os };
    }
    if (typeof w.webkit?.messageHandlers?.openLocationSettings?.postMessage === 'function') {
      w.webkit.messageHandlers.openLocationSettings.postMessage({
        target: mode === 'app_details' ? 'app_settings' : 'location'
      });
      return { launchedNative: true, method: 'native-bridge', os };
    }
    if (typeof w.cordova?.plugins?.settings?.open === 'function') {
      w.cordova.plugins.settings.open(mode === 'app_details' ? 'application_details' : 'location');
      return { launchedNative: true, method: 'native-bridge', os };
    }
  } catch {
    // Fall through cleanly to OS browser launcher
  }

  const isTopLevelWindow = (() => {
    try {
      return window.self === window.top;
    } catch {
      return false;
    }
  })();

  // 2. Android Chrome / Edge / Samsung Internet PWA: safe Android Settings Intent URI with same-origin fallback
  if (os === 'android' && isTopLevelWindow) {
    try {
      const safeFallback = `${window.location.origin}${window.location.pathname}`;
      const encodedFallback = encodeURIComponent(safeFallback);
      const intentUri =
        mode === 'app_details'
          ? `intent:#Intent;action=android.settings.APPLICATION_SETTINGS;S.browser_fallback_url=${encodedFallback};end`
          : `intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;S.browser_fallback_url=${encodedFallback};end`;

      const anchor = document.createElement('a');
      anchor.href = intentUri;
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      return { launchedNative: true, method: 'android-intent', os };
    } catch {
      // Fall through cleanly
    }
  }

  return { launchedNative: false, method: 'settings-panel', os };
}

export const DEVICE_LOCATION_STEPS: Record<
  DeviceOsType,
  { title: string; subtitle: string; steps: string[] }
> = {
  android: {
    title: 'Android Device Location Settings',
    subtitle: 'Turn ON Location and set FreshVeggie / Browser permission to Allow.',
    steps: [
      'Tap "Open Device Location Settings" above (or pull down Android Quick Settings and switch Location ON).',
      'In Android Settings -> Apps -> FreshVeggie (or Chrome) -> Permissions -> Location.',
      'Select "Allow only while using the app" (or "Allow all the time") and enable "Use precise location".',
      'Return to this screen — GPS sync will start automatically.'
    ]
  },
  ios: {
    title: 'iPhone / iPad Location Settings (iOS)',
    subtitle: 'Enable iOS Location Services and Website Location access.',
    steps: [
      'Open iPhone Settings -> Privacy & Security -> Location Services and turn Location Services ON.',
      'Scroll down to Safari Websites (or FreshVeggie App) and tap it.',
      'Select "While Using the App" and toggle "Precise Location" ON.',
      'Inside Safari, tap "aA" in the address bar -> Website Settings -> Location -> Allow.'
    ]
  },
  desktop: {
    title: 'Browser Location Permission Settings',
    subtitle: 'Allow Location permission in Chrome, Edge, Firefox, or Safari.',
    steps: [
      'Click the lock/tune icon to the left of the browser address bar and switch Location to "Allow".',
      'Or use "Copy Browser Location Settings Link" above and paste it into a new tab address bar.',
      'Ensure device OS Location Services (Windows Location / macOS Privacy & Security) are turned ON.'
    ]
  }
};
