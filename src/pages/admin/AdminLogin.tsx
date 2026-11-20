import React, { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, ArrowLeft, ShieldAlert, LogOut, Copy } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { PhoneOtpAuthCard } from '../../components/PhoneOtpAuthCard';

export const AdminLogin = () => {
  const navigate = useNavigate();
  const { firebaseUser, authReady, isAdmin, logout } = useAuth();
  const { showToast } = useToast();

  useEffect(() => {
    if (authReady && firebaseUser && isAdmin) {
      navigate('/admin/dashboard', { replace: true });
    }
  }, [authReady, firebaseUser, isAdmin, navigate]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm text-gray-400">Checking administrator session...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white relative">
      <Link
        to="/home"
        className="absolute top-4 left-4 sm:top-6 sm:left-6 px-4 py-2 bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors flex items-center gap-2"
      >
        <ArrowLeft size={18} />
        <span className="text-sm font-medium">Back to Home</span>
      </Link>

      <div className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center mb-5 shadow-lg shadow-blue-500/40 mt-12 sm:mt-0">
        <Shield size={40} className="text-white" />
      </div>

      <h1 className="text-3xl font-bold mb-2">Admin Control</h1>
      <p className="text-gray-400 mb-6 text-center text-sm max-w-xs">
        Role-protected store governance powered by Firebase Authentication &amp;
        Firestore RBAC
      </p>

      {firebaseUser && !isAdmin ? (
        <div className="w-full max-w-sm bg-gray-800 border border-red-500/30 rounded-2xl p-6 text-center space-y-4 shadow-xl">
          <div className="w-14 h-14 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto">
            <ShieldAlert size={28} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Unauthorized Account</h2>
            <p className="text-xs text-gray-400 mt-1">
              Signed in as{' '}
              <span className="font-semibold text-gray-200 break-all">
                {firebaseUser.phoneNumber || firebaseUser.email}
              </span>
              . Only the Store Owner Google account or UIDs allowlisted in Admin Settings can access the Control Center.
            </p>
          </div>

          <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 text-left space-y-1">
            <p className="text-[10px] font-bold uppercase text-gray-400">Your Firebase Auth UID</p>
            <div className="flex items-center justify-between gap-2">
              <code className="text-xs font-mono text-blue-300 truncate">{firebaseUser.uid}</code>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(firebaseUser.uid);
                    showToast('UID copied! Ask the Store Owner to grant access in Settings.', 'info');
                  } catch {
                    showToast(`UID: ${firebaseUser.uid}`, 'info');
                  }
                }}
                className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 shrink-0"
                title="Copy UID"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 pt-1">
            <button
              type="button"
              onClick={async () => {
                await logout();
                showToast('Signed out. Sign in with an authorized Admin phone or Google account.', 'info');
              }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition"
            >
              <LogOut size={16} />
              Switch Admin Account
            </button>
            <Link
              to="/home"
              className="w-full bg-gray-700 hover:bg-gray-600 text-gray-200 py-2.5 rounded-xl font-semibold text-xs transition"
            >
              Return to Storefront
            </Link>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-sm space-y-4">
          <PhoneOtpAuthCard
            theme="dark"
            accent="blue"
            createCustomerProfile={false}
            googleLabel="Owner Sign In with Google"
          />
          <p className="text-xs text-gray-400 text-center">
            Authorized phone admins verify via SMS OTP. Store owners can also sign in
            with their verified Google account.
          </p>
        </div>
      )}
    </div>
  );
};
