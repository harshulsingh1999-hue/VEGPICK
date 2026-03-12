import React, { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator = () => {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 md:bottom-4 md:left-auto md:right-4 md:w-auto bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4">
      <WifiOff size={20} className="text-red-400" />
      <div>
        <p className="font-medium text-sm">You are offline</p>
        <p className="text-xs text-gray-400">App is running in offline mode</p>
      </div>
    </div>
  );
};
