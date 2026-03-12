import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { User, MapPin, LogOut, Edit2, Tag, ChevronRight, Truck, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';

export const Profile = () => {
  const { user, login, register, checkUserExists, logout, updateProfile } = useAuth();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');

  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.length === 10) setShowOtp(true);
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length === 4) {
      if (checkUserExists(phone)) {
        login(phone);
      } else {
        setShowRegister(true);
        setShowOtp(false);
      }
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (name && email) {
      register(phone, name, email);
    }
  };

  const handleLogout = () => {
    logout();
    window.location.href = '/';
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
          <User className="text-green-600" size={40} />
        </div>
        <h1 className="text-2xl font-bold mb-2">Welcome</h1>
        <p className="text-gray-500 mb-8 text-center">Login to manage your orders and address</p>
        
        {!showOtp && !showRegister ? (
          <form onSubmit={handleSendOtp} className="w-full max-w-sm space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="Enter 10 digit number"
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                required
              />
            </div>
            <button 
              type="submit"
              disabled={phone.length !== 10}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-medium disabled:bg-gray-300"
            >
              Send OTP
            </button>
          </form>
        ) : showRegister ? (
          <form onSubmit={handleRegister} className="w-full max-w-sm space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@example.com"
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                required
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-green-600 text-white py-3 rounded-lg font-medium"
            >
              Complete Registration
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="w-full max-w-sm space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Enter OTP</label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="1234"
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none tracking-widest text-center text-xl"
                required
              />
              <p className="text-xs text-gray-500 mt-2">Use any 4 digits</p>
            </div>
            <button 
              type="submit"
              disabled={otp.length !== 4}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-medium disabled:bg-gray-300"
            >
              Verify & Login
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="pb-24 pt-4 px-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">My Profile</h1>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-bold text-xl">
            {user.name.charAt(0)}
          </div>
          <div className="flex-1">
            {isEditing ? (
              <div className="flex flex-col gap-2">
                <input 
                  value={editName} 
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Name"
                  className="border rounded px-2 py-1 w-full"
                />
                <input 
                  value={editEmail} 
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="Email"
                  className="border rounded px-2 py-1 w-full"
                />
                <button 
                  onClick={() => { 
                    updateProfile({ 
                      name: editName || user.name,
                      email: editEmail || user.email 
                    }); 
                    setIsEditing(false); 
                  }}
                  className="bg-green-600 text-white text-sm font-medium py-1 rounded"
                >
                  Save Changes
                </button>
              </div>
            ) : (
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="font-bold text-lg">{user.name}</h2>
                  <p className="text-gray-500 text-sm">{user.phone}</p>
                  <p className="text-gray-500 text-sm">{user.email || 'No email added'}</p>
                </div>
                <button onClick={() => { 
                  setEditName(user.name); 
                  setEditEmail(user.email);
                  setIsEditing(true); 
                }} className="p-2 text-gray-400 hover:text-green-600">
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
          {user.addresses.map(addr => (
            <div key={addr.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100">
              <div className="flex justify-between">
                <span className="font-medium text-sm bg-white px-2 py-0.5 rounded border border-gray-200">{addr.label}</span>
              </div>
              <p className="text-sm text-gray-600 mt-2">{addr.street}, {addr.city} - {addr.zip}</p>
            </div>
          ))}
          <button className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-green-500 hover:text-green-600 text-sm font-medium">
            + Add New Address
          </button>
        </div>
      </div>

      <Link to="/coupons" className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-6 flex justify-between items-center">
        <div className="flex items-center gap-3 text-gray-800 font-medium">
          <Tag size={20} className="text-orange-500" />
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
