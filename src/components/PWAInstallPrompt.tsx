import React, { useState } from 'react';
import { Download, X, Share } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { AppLogo } from './AppLogo';

export const PWAInstallPrompt: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Hide on Admin & Delivery portals, or if already installed/dismissed
  if (
    isInstalled ||
    dismissed ||
    location.pathname.startsWith('/admin') ||
    location.pathname.startsWith('/delivery')
  ) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable && !isIOS) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      {/* Top Banner on Mobile */}
      <div className="bg-gradient-to-r from-emerald-600 to-green-700 text-white px-4 py-2.5 shadow-md flex items-center justify-between gap-3 text-xs sm:text-sm">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <AppLogo
            size={36}
            roundedClassName="rounded-lg"
            className="shadow-xs ring-1 ring-white/25"
          />
          <div className="truncate">
            <p className="font-bold truncate">
              {isIOS ? 'Install FreshVeggie iOS App' : 'Install FreshVeggie Mobile App'}
            </p>
            <p className="text-[11px] text-green-100 truncate">
              Fast loading, notifications & offline access
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleInstallClick}
            className="flex items-center gap-1.5 bg-white text-green-700 font-bold px-3 py-1.5 rounded-lg shadow-sm hover:bg-green-50 active:scale-95 transition-all text-xs"
          >
            {isIOS ? <Share size={14} /> : <Download size={14} />}
            Install
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1 hover:bg-white/10 rounded-full text-white/80 hover:text-white transition-colors"
            aria-label="Dismiss banner"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Manual Install Guide Modal (iOS Safari or Android Chrome) */}
      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-gray-900 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <AppLogo size={44} roundedClassName="rounded-xl" className="shadow-xs" />
                <div>
                  <h3 className="font-bold text-base">
                    {isIOS ? 'Install on iPhone / iPad' : 'Install on Android'}
                  </h3>
                  <p className="text-xs text-gray-500">Add FreshVeggie to your Home Screen</p>
                </div>
              </div>
              <button
                onClick={() => setShowGuide(false)}
                className="p-1 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-3 my-4 bg-gray-50 p-4 rounded-xl text-xs text-gray-700">
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-green-600 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">1</span>
                  <p>Tap the <strong>Share button (□↑)</strong> in Safari at the bottom or top of your screen.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-green-600 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">2</span>
                  <p>Scroll down and tap <strong>"Add to Home Screen"</strong>.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-green-600 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">3</span>
                  <p>Tap <strong>"Add"</strong> in the top right to launch FreshVeggie like a native iOS app.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 my-4 bg-gray-50 p-4 rounded-xl text-xs text-gray-700">
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-green-600 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">1</span>
                  <p>Tap the <strong>three dots menu (⋮)</strong> in Chrome or your Android browser at the top right.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-green-600 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">2</span>
                  <p>Select <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-green-600 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">3</span>
                  <p>Tap <strong>"Install"</strong> to add the FreshVeggie app icon to your Android app drawer.</p>
                </div>
              </div>
            )}

            <button
              onClick={() => setShowGuide(false)}
              className="w-full rounded-xl bg-green-600 py-2.5 text-sm font-bold text-white hover:bg-green-700 transition"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
