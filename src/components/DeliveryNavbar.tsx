import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, IndianRupee, TrendingUp, User } from 'lucide-react';

export const DeliveryNavbar = () => {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 py-2 px-4 z-50">
      <div className="max-w-md mx-auto flex justify-between items-center">
        <Link to="/delivery/dashboard" className={`flex flex-col items-center p-2 ${isActive('/delivery/dashboard') ? 'text-green-400' : 'text-gray-500'}`}>
          <Home size={24} />
          <span className="text-[10px] mt-1 font-medium">Dashboard</span>
        </Link>
        
        <Link to="/delivery/earnings" className={`flex flex-col items-center p-2 ${isActive('/delivery/earnings') ? 'text-green-400' : 'text-gray-500'}`}>
          <IndianRupee size={24} />
          <span className="text-[10px] mt-1 font-medium">Earnings</span>
        </Link>

        <Link to="/delivery/performance" className={`flex flex-col items-center p-2 ${isActive('/delivery/performance') ? 'text-green-400' : 'text-gray-500'}`}>
          <TrendingUp size={24} />
          <span className="text-[10px] mt-1 font-medium">Performance</span>
        </Link>
      </div>
    </nav>
  );
};
