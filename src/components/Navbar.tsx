import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, ShoppingCart, User, Search, History } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { AppLogo } from './AppLogo';

export const Navbar = () => {
  const { cart } = useStore();
  const location = useLocation();
  
  // Hide navbar on welcome, delivery, and admin pages
  if (location.pathname === '/' || location.pathname.startsWith('/delivery') || location.pathname.startsWith('/admin')) {
    return null;
  }

  const cartCount = cart.reduce((acc, item) => acc + item.quantity, 0);

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 pt-1 pb-1 safe-bottom px-2 z-50 md:sticky md:top-0 md:bottom-auto md:border-t-0 md:border-b md:pt-2 md:pb-2">
      <div className="max-w-7xl mx-auto flex justify-around md:justify-between items-center">
        <Link to="/home" className="hidden md:flex items-center gap-2.5 shrink-0">
          <AppLogo size={34} roundedClassName="rounded-lg" className="shadow-xs" />
          <span className="text-2xl font-bold text-green-600 whitespace-nowrap">FreshVeggie</span>
        </Link>

        <div className="flex w-full md:w-auto justify-around md:gap-8">
          <Link to="/home" className={`flex flex-col items-center p-2 ${isActive('/home') ? 'text-green-600' : 'text-gray-500'}`}>
            <Home size={24} />
            <span className="text-xs mt-1">Home</span>
          </Link>
          
          <Link to="/browse" className={`flex flex-col items-center p-2 ${isActive('/browse') ? 'text-green-600' : 'text-gray-500'}`}>
            <Search size={24} />
            <span className="text-xs mt-1">Browse</span>
          </Link>

          <Link to="/cart" className={`flex flex-col items-center p-2 relative ${isActive('/cart') ? 'text-green-600' : 'text-gray-500'}`}>
            <ShoppingCart size={24} />
            <span className="text-xs mt-1">Cart</span>
            {cartCount > 0 && (
              <span className="absolute top-1 right-1 bg-red-500 text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full">
                {cartCount}
              </span>
            )}
          </Link>

          <Link to="/orders" className={`flex flex-col items-center p-2 ${isActive('/orders') ? 'text-green-600' : 'text-gray-500'}`}>
            <History size={24} />
            <span className="text-xs mt-1">Orders</span>
          </Link>

          <Link to="/profile" className={`flex flex-col items-center p-2 ${isActive('/profile') ? 'text-green-600' : 'text-gray-500'}`}>
            <User size={24} />
            <span className="text-xs mt-1">Profile</span>
          </Link>
        </div>
      </div>
    </nav>
  );
};
