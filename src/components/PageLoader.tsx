import React from 'react';
import { Loader2 } from 'lucide-react';

export const PageLoader = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-10 h-10 text-green-600 animate-spin" />
        <p className="text-gray-500 font-medium">Loading...</p>
      </div>
    </div>
  );
};
