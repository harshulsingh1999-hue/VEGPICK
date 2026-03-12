import React, { useState } from 'react';
import { useDelivery } from '../../context/DeliveryContext';
import { useNavigate, Link } from 'react-router-dom';
import { Truck, Lock, User, Phone, ArrowLeft } from 'lucide-react';

export const DeliveryLogin = () => {
  const { login } = useDelivery();
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [error, setError] = useState('');

  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (id && password) {
      setShowOtp(true);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (login(id, password)) {
      navigate('/delivery/dashboard');
    } else {
      setError('Invalid ID or Password (Try DEL001 / 123456)');
      setShowOtp(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white relative">
      <Link to="/" className="absolute top-4 left-4 sm:top-6 sm:left-6 px-4 py-2 bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors flex items-center gap-2">
        <ArrowLeft size={18} />
        <span className="text-sm font-medium">Back to Home</span>
      </Link>

      <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-green-500/50">
        <Truck size={40} className="text-white" />
      </div>
      
      <h1 className="text-3xl font-bold mb-2">Delivery Partner</h1>
      <p className="text-gray-400 mb-8">Secure login to manage your deliveries</p>

      {!showOtp ? (
        <form onSubmit={handleSendOtp} className="w-full max-w-sm space-y-4">
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="Delivery ID"
              className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500"
              required
            />
          </div>
          
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500"
              required
            />
          </div>

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <button 
            type="submit"
            className="w-full bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-600/20"
          >
            Send Login OTP
          </button>

          <div className="text-center mt-6">
            <p className="text-gray-400 text-sm">Don't have an account?</p>
            <Link to="/delivery/register" className="text-green-400 font-bold hover:underline mt-1 inline-block">
              Register as Delivery Partner
            </Link>
          </div>
        </form>
      ) : (
        <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4 animate-in fade-in">
          <div className="bg-gray-800 p-4 rounded-xl mb-4 text-center border border-gray-700">
            <p className="text-sm text-gray-400">OTP sent to registered mobile</p>
            <p className="font-bold text-white mt-1">******0000</p>
          </div>

          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="Enter OTP (Any 4 digits)"
              className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500 tracking-widest text-center text-xl"
              required
            />
          </div>

          <button 
            type="submit"
            className="w-full bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-600/20"
          >
            Verify & Login
          </button>
          
          <button 
            type="button"
            onClick={() => setShowOtp(false)}
            className="w-full bg-transparent text-gray-400 py-3 rounded-xl font-bold hover:text-white transition-colors"
          >
            Back
          </button>
        </form>
      )}
    </div>
  );
};
