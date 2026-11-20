import React, { useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDelivery } from '../../context/DeliveryContext';
import { useToast } from '../../context/ToastContext';
import { useNavigate, Link } from 'react-router-dom';
import {
  Truck,
  ArrowLeft,
  Clock,
  LogOut,
  UserPlus,
  CheckCircle2,
  ShieldCheck
} from 'lucide-react';
import { PhoneOtpAuthCard } from '../../components/PhoneOtpAuthCard';

export const DeliveryLogin = () => {
  const { firebaseUser, authReady, logout } = useAuth();
  const { deliveryUser, partnerLoading } = useDelivery();
  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (authReady && !partnerLoading && firebaseUser && deliveryUser?.isApproved) {
      navigate('/delivery/dashboard', { replace: true });
    }
  }, [authReady, partnerLoading, firebaseUser, deliveryUser, navigate]);

  if (!authReady || (firebaseUser && partnerLoading)) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white">
        <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm text-gray-400">Verifying partner session...</p>
      </div>
    );
  }

  const verifiedLabel = firebaseUser?.phoneNumber || firebaseUser?.email || firebaseUser?.uid || '';

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white relative safe-top">
      <Link
        to="/home"
        className="absolute top-4 left-4 sm:top-6 sm:left-6 px-4 py-2 bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors flex items-center gap-2"
      >
        <ArrowLeft size={18} />
        <span className="text-sm font-medium">Back to Home</span>
      </Link>

      <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mb-5 shadow-lg shadow-green-500/40 mt-12 sm:mt-0">
        <Truck size={40} className="text-white" />
      </div>

      <h1 className="text-3xl font-bold mb-2">Delivery Partner</h1>
      <p className="text-gray-400 mb-6 text-center max-w-xs text-sm">
        Verified Firebase Mobile OTP &amp; Google access for active fleet dispatch
      </p>

      {!firebaseUser ? (
        <div className="w-full max-w-sm space-y-4">
          <PhoneOtpAuthCard
            theme="dark"
            accent="green"
            createCustomerProfile={false}
          />

          <div className="bg-gray-800/70 border border-gray-700 rounded-xl p-4 text-xs text-gray-300 space-y-1.5">
            <p className="font-bold text-white flex items-center gap-1.5">
              <ShieldCheck size={15} className="text-green-400" />
              Partner Access Policy
            </p>
            <p className="text-gray-400">
              Sign in with your approved mobile number or Google account to view live
              dispatch trips. New riders can submit KYC registration for Admin approval.
            </p>
          </div>

          <div className="text-center pt-1">
            <p className="text-gray-400 text-sm">New to FreshVeggie fleet?</p>
            <Link
              to="/delivery/register"
              className="text-green-400 font-bold hover:underline mt-1 inline-flex items-center gap-1.5"
            >
              <UserPlus size={16} />
              Register as Delivery Partner
            </Link>
          </div>
        </div>
      ) : deliveryUser && !deliveryUser.isApproved ? (
        <div className="w-full max-w-sm bg-gray-800 border border-yellow-500/30 rounded-2xl p-6 space-y-4 text-center shadow-xl">
          <div className="w-14 h-14 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center mx-auto">
            <Clock size={28} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">
              Application Pending Approval
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              Your partner profile has been submitted and is awaiting Store Admin
              verification.
            </p>
          </div>

          <div className="bg-gray-900 rounded-xl p-3.5 text-left text-xs space-y-1.5 border border-gray-700">
            <div className="flex justify-between">
              <span className="text-gray-400">Partner Code:</span>
              <span className="font-bold text-green-400">
                {deliveryUser.partnerCode}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Name:</span>
              <span className="font-semibold text-white">{deliveryUser.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Assigned Zone:</span>
              <span className="font-semibold text-white">{deliveryUser.area}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Vehicle:</span>
              <span className="font-semibold text-white">
                {deliveryUser.vehicle}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Contact:</span>
              <span className="font-semibold text-gray-300 truncate max-w-[180px]">
                {deliveryUser.phone ? `+${deliveryUser.phone}` : deliveryUser.email}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={async () => {
              await logout();
              showToast('Signed out', 'info');
            }}
            className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition"
          >
            <LogOut size={15} />
            Sign Out / Switch Account
          </button>
        </div>
      ) : !deliveryUser ? (
        <div className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-2xl p-6 space-y-4 text-center shadow-xl">
          <div className="w-12 h-12 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center mx-auto">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-400">Signed in as</p>
            <p className="text-sm font-bold text-white mt-0.5 break-all">
              {verifiedLabel}
            </p>
            <p className="text-xs text-gray-400 mt-2">
              No delivery partner profile is linked to this account yet.
            </p>
          </div>

          <Link
            to="/delivery/register"
            className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-green-600/20"
          >
            <UserPlus size={18} />
            Complete Partner Registration
          </Link>

          <button
            type="button"
            onClick={async () => {
              await logout();
            }}
            className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition"
          >
            <LogOut size={14} />
            Switch Account
          </button>
        </div>
      ) : null}
    </div>
  );
};
