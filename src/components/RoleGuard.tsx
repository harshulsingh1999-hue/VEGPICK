import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ShieldAlert, Monitor } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDelivery } from '../context/DeliveryContext';

interface RoleGuardProps {
  allowedRole: 'admin' | 'admin-login' | 'delivery';
  children: React.ReactNode;
}

const isStandaloneMobileClient = (): boolean => {
  if (typeof window === 'undefined') return false;
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return standalone && window.innerWidth < 768;
};

/**
 * Strict route-level Role-Based Access Control (RBAC) guard.
 * Prevents customers or unapproved accounts from mounting Delivery or Super Admin bundles,
 * and isolates Super Admin routes from installed mobile storefront apps.
 */
export const RoleGuard: React.FC<RoleGuardProps> = ({ allowedRole, children }) => {
  const { firebaseUser, authReady, isAdmin } = useAuth();
  const { deliveryUser, partnerLoading } = useDelivery();

  if (!authReady || (allowedRole === 'delivery' && firebaseUser && partnerLoading)) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white">
        <div className="w-9 h-9 border-4 border-green-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs text-gray-400">Verifying role permissions...</p>
      </div>
    );
  }

  if (allowedRole === 'admin-login' || allowedRole === 'admin') {
    if (isStandaloneMobileClient() && !isAdmin) {
      return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/20 text-blue-400 flex items-center justify-center mb-4">
            <Monitor size={32} />
          </div>
          <h1 className="text-xl font-bold mb-2">Web Desktop / Tablet Only</h1>
          <p className="text-xs text-gray-400 max-w-xs mb-6 leading-relaxed">
            Super Admin Control Center is disabled inside the mobile customer app for security. Open FreshVeggie in a desktop or tablet web browser to manage the store.
          </p>
          <Link
            to="/home"
            className="bg-green-600 hover:bg-green-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition"
          >
            Back to Storefront
          </Link>
        </div>
      );
    }

    if (allowedRole === 'admin' && (!firebaseUser || !isAdmin)) {
      return <Navigate to="/admin/login" replace />;
    }

    return <>{children}</>;
  }

  if (allowedRole === 'delivery') {
    if (!firebaseUser || !deliveryUser || !deliveryUser.isApproved) {
      return <Navigate to="/delivery/login" replace />;
    }
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6 text-center">
      <ShieldAlert size={36} className="text-red-400 mb-3" />
      <h2 className="text-lg font-bold">Access Denied</h2>
    </div>
  );
};
