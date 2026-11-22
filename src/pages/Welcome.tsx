import React, { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useDelivery } from '../context/DeliveryContext';
import { ShoppingBag, Truck, Shield, Smartphone, Download, Phone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useToast } from '../context/ToastContext';
import { PhoneOtpAuthCard } from '../components/PhoneOtpAuthCard';
import { AppLogo } from '../components/AppLogo';

export const Welcome = () => {
  const { user, authReady, isAdmin } = useAuth();
  const { deliveryUser, partnerLoading } = useDelivery();
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const { showToast } = useToast();
  const [showOtpLogin, setShowOtpLogin] = useState(false);

  if (authReady && isAdmin) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  if (authReady && !partnerLoading && deliveryUser?.isApproved) {
    return <Navigate to="/delivery/dashboard" replace />;
  }

  if (authReady && user) {
    return <Navigate to="/home" replace />;
  }

  return (
    <div className="min-h-screen bg-green-600 flex flex-col items-center justify-center p-4 text-white relative">
      {!isInstalled && (
        <Link
          to="/admin/login"
          className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-sm font-medium"
        >
          <Shield size={16} />
          Admin
        </Link>
      )}

      <AppLogo
        size={96}
        roundedClassName="rounded-3xl"
        className="mb-5 shadow-2xl ring-2 ring-white/30"
      />

      <h1 className="text-4xl font-bold mb-2 text-center">FreshVeggie</h1>
      <p className="text-green-100 mb-6 text-center max-w-xs text-sm">
        Farm fresh vegetables delivered directly to your doorstep
      </p>

      {showOtpLogin ? (
        <div className="w-full max-w-sm space-y-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowOtpLogin(false)}
              className="text-xs font-semibold text-green-100 hover:text-white flex items-center gap-1 bg-white/15 px-3 py-1.5 rounded-full"
            >
              <X size={14} /> Close Sign In
            </button>
          </div>
          <PhoneOtpAuthCard
            title="Customer Mobile Sign In"
            subtitle="Sign in with a 6-digit Firebase SMS OTP to sync your cart and orders."
            createCustomerProfile
          />
        </div>
      ) : (
        <div className="w-full max-w-sm space-y-3">
          <button
            type="button"
            onClick={() => setShowOtpLogin(true)}
            className="w-full bg-white text-green-700 py-3.5 rounded-xl font-bold text-base flex items-center justify-center gap-2.5 shadow-lg hover:bg-gray-50 active:scale-95 transition-all"
          >
            <Phone size={20} />
            Sign In with Mobile OTP
          </button>

          <Link
            to="/home"
            className="w-full bg-white/20 hover:bg-white/30 text-white py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all border border-white/30"
          >
            <ShoppingBag size={18} />
            Explore Store / Shop Now
          </Link>

          <Link
            to="/delivery/login"
            className="w-full bg-green-700 text-white py-3.5 rounded-xl font-bold text-base flex items-center justify-center gap-3 shadow-lg hover:bg-green-800 active:scale-95 transition-all border border-green-500"
          >
            <Truck size={22} />
            Delivery Partner Portal
          </Link>

          {!isInstalled && (
            <button
              onClick={async () => {
                if (isInstallable) {
                  await install();
                } else {
                  showToast(
                    'To install on Android/iOS: open browser Share or Menu and tap "Add to Home Screen".',
                    'info'
                  );
                }
              }}
              className="w-full bg-emerald-800/60 hover:bg-emerald-800/80 text-emerald-100 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2.5 transition-all border border-emerald-400/30"
            >
              <Smartphone size={18} className="text-emerald-300" />
              Install Android / iOS App
              <Download size={16} className="text-emerald-300" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
