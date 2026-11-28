import React from 'react';
import { Link } from 'react-router-dom';
import { Compass, Home, Search } from 'lucide-react';

export const NotFound = () => {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="w-20 h-20 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center mb-5 border border-green-100">
        <Compass size={38} />
      </div>
      <p className="text-xs font-bold uppercase tracking-widest text-green-600 mb-1">404</p>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Page not found</h1>
      <p className="text-sm text-gray-500 max-w-sm mb-7 leading-relaxed">
        The link you opened does not exist or may have moved. Head back to FreshVeggie to keep browsing fresh farm produce.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
        <Link
          to="/home"
          className="flex-1 inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-3 px-4 rounded-xl font-semibold text-sm transition"
        >
          <Home size={16} />
          Home
        </Link>
        <Link
          to="/browse"
          className="flex-1 inline-flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 py-3 px-4 rounded-xl font-semibold text-sm transition"
        >
          <Search size={16} />
          Browse Veggies
        </Link>
      </div>
    </div>
  );
};
