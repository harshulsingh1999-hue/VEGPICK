import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { User, MapPin, LogOut, Edit2, Tag, ChevronRight, Package } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { PhoneOtpAuthCard } from '../components/PhoneOtpAuthCard';
import { PushPermissionBanner } from '../components/PushPermissionBanner';

export const Profile = () => {
  const { user, firebaseUser, authReady, ensureCustomerProfile, orders, logout, updateProfile, addAddress } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');

  const [showAddAddress, setShowAddAddress] = useState(false);
  const [newLabel, setNewLabel] = useState('Home');
  const [newStreet, setNewStreet] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newZip, setNewZip] = useState('');

  const [profileInitError, setProfileInitError] = useState<string | null>(null);
  const [retryingProfile, setRetryingProfile] = useState(false);

  useEffect(() => {
    if (authReady && firebaseUser && !user) {
      setProfileInitError(null);
      ensureCustomerProfile().catch((err) => {
        setProfileInitError(
          err instanceof Error ? err.message : 'Unable to initialize your customer profile.'
        );
      });
    }
  }, [authReady, firebaseUser, user, ensureCustomerProfile]);

  const handleLogout = async () => {
    await logout();
    showToast('Logged out successfully', 'info');
    navigate('/home');
  };

  if (!authReady || (firebaseUser && !user && !profileInitError)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-3">
        <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-gray-500">Loading your account...</p>
      </div>
    );
  }

  if (firebaseUser && !user && profileInitError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center max-w-sm mx-auto space-y-4">
        <div className="w-14 h-14 bg-red-50 text-red-600 rounded-full flex items-center justify-center">
          <User size={28} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Account Setup Interrupted</h2>
          <p className="text-xs text-gray-500 mt-1">{profileInitError}</p>
        </div>
        <div className="flex gap-2 w-full">
          <button
            type="button"
            disabled={retryingProfile}
            onClick={async () => {
              setRetryingProfile(true);
              setProfileInitError(null);
              try {
                await ensureCustomerProfile();
              } catch (err) {
                setProfileInitError(
                  err instanceof Error ? err.message : 'Retry failed. Please check connection.'
                );
              } finally {
                setRetryingProfile(false);
              }
            }}
            className="flex-1 bg-green-600 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-green-700 disabled:opacity-50"
          >
            {retryingProfile ? 'Retrying...' : 'Retry'}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl text-xs font-bold hover:bg-gray-200"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 py-8">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-5">
          <User className="text-green-600" size={40} />
        </div>
        <h1 className="text-2xl font-bold mb-2">Customer Account</h1>
        <p className="text-gray-500 mb-6 text-center max-w-sm text-sm">
          Sign in securely with your mobile number via Firebase SMS OTP to sync your cart, saved addresses, and live order tracking.
        </p>

        <div className="w-full max-w-sm">
          <PhoneOtpAuthCard createCustomerProfile />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24 pt-4 px-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">My Profile</h1>

      <div className="mb-5">
        <PushPermissionBanner role="customer" theme="light" />
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-bold text-xl shrink-0">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="flex flex-col gap-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Full Name"
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-full outline-none focus:ring-2 focus:ring-green-500"
                />
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value.replace(/\D/g, '').slice(0, 15))}
                  placeholder="10-digit Mobile Number"
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-full outline-none focus:ring-2 focus:ring-green-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (editPhone && editPhone.length < 10) {
                        showToast('Please enter a valid 10-digit mobile number', 'error');
                        return;
                      }
                      await updateProfile({
                        name: editName.trim() || user.name,
                        phone: editPhone
                      });
                      setIsEditing(false);
                      showToast('Profile updated!', 'success');
                    }}
                    className="flex-1 bg-green-600 text-white text-xs font-bold py-2 rounded-lg"
                  >
                    Save Changes
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <h2 className="font-bold text-lg truncate">{user.name}</h2>
                  {user.email && (
                    <p className="text-gray-500 text-sm truncate">{user.email}</p>
                  )}
                  <p className={`text-xs mt-0.5 ${user.phone ? 'text-gray-700 font-semibold' : 'text-amber-600 font-semibold'}`}>
                    {user.phone ? `Verified Mobile: +${user.phone}` : 'Add mobile number for deliveries'}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setEditName(user.name);
                    setEditPhone(user.phone || '');
                    setIsEditing(true);
                  }}
                  className="p-2 text-gray-400 hover:text-green-600"
                  aria-label="Edit profile"
                >
                  <Edit2 size={18} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <MapPin size={18} /> Saved Addresses
          </h3>
          {user.addresses?.map((addr) => (
            <div key={addr.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100 flex justify-between items-start">
              <div>
                <span className="font-medium text-xs bg-white px-2 py-0.5 rounded border border-gray-200">{addr.label}</span>
                <p className="text-sm text-gray-700 mt-1">{addr.street}, {addr.city} - {addr.zip}</p>
              </div>
              <button
                onClick={async () => {
                  const filtered = user.addresses.filter((a) => a.id !== addr.id);
                  await updateProfile({ addresses: filtered });
                  showToast('Address removed', 'info');
                }}
                className="text-xs text-red-500 hover:text-red-700 font-medium ml-2"
              >
                Delete
              </button>
            </div>
          ))}

          {showAddAddress ? (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
              <p className="font-bold text-sm text-gray-800">Add New Address</p>
              <div className="flex gap-2">
                {['Home', 'Work', 'Other'].map((lbl) => (
                  <button
                    key={lbl}
                    type="button"
                    onClick={() => setNewLabel(lbl)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border ${
                      newLabel === lbl ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-200'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Street / House No."
                value={newStreet}
                onChange={(e) => setNewStreet(e.target.value)}
                className="w-full p-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-green-500"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="City"
                  value={newCity}
                  onChange={(e) => setNewCity(e.target.value)}
                  className="w-full p-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-green-500"
                />
                <input
                  type="text"
                  placeholder="Pincode"
                  value={newZip}
                  onChange={(e) => setNewZip(e.target.value)}
                  className="w-full p-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    if (!newStreet.trim() || !newCity.trim() || newZip.trim().length < 3) {
                      showToast('Please enter street, city, and valid pincode', 'error');
                      return;
                    }
                    await addAddress({
                      label: newLabel,
                      street: newStreet.trim(),
                      city: newCity.trim(),
                      zip: newZip.trim()
                    });
                    setShowAddAddress(false);
                    setNewStreet('');
                    setNewCity('');
                    setNewZip('');
                    showToast('Address saved!', 'success');
                  }}
                  className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddAddress(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddAddress(true)}
              className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-green-500 hover:text-green-600 text-sm font-medium transition"
            >
              + Add New Address
            </button>
          )}
        </div>
      </div>

      <Link to="/orders" className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-3 flex justify-between items-center hover:bg-gray-50 transition">
        <div className="flex items-center gap-3 text-gray-800 font-medium">
          <div className="w-9 h-9 rounded-full bg-green-50 text-green-600 flex items-center justify-center">
            <Package size={20} />
          </div>
          <div>
            <p className="text-sm font-bold">My Orders &amp; Tracking</p>
            <p className="text-xs text-gray-400">{orders.length} {orders.length === 1 ? 'order' : 'orders'} placed</p>
          </div>
        </div>
        <ChevronRight size={20} className="text-gray-400" />
      </Link>

      <Link to="/coupons" className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-6 flex justify-between items-center hover:bg-gray-50 transition">
        <div className="flex items-center gap-3 text-gray-800 font-medium">
          <div className="w-9 h-9 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center">
            <Tag size={20} />
          </div>
          <span>Available Coupons</span>
        </div>
        <ChevronRight size={20} className="text-gray-400" />
      </Link>

      <button
        onClick={handleLogout}
        className="w-full bg-red-50 text-red-600 py-3 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-red-100"
      >
        <LogOut size={18} />
        Logout
      </button>
    </div>
  );
};
