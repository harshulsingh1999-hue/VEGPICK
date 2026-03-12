import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, Lock, User, ArrowLeft } from 'lucide-react';

export const AdminLogin = () => {
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (id === 'admin' && password === 'admin') {
      localStorage.setItem('adminAuth', 'true');
      navigate('/admin/dashboard');
    } else {
      setError('Invalid ID or Password (Try admin / admin)');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white relative">
      <Link to="/" className="absolute top-4 left-4 sm:top-6 sm:left-6 px-4 py-2 bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors flex items-center gap-2">
        <ArrowLeft size={18} />
        <span className="text-sm font-medium">Back to Home</span>
      </Link>

      <div className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-blue-500/50">
        <Shield size={40} className="text-white" />
      </div>
      
      <h1 className="text-3xl font-bold mb-2">Admin Panel</h1>
      <p className="text-gray-400 mb-8">Main Control Login</p>

      <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="Admin ID"
            className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-white placeholder-gray-500"
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
            className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-white placeholder-gray-500"
            required
          />
        </div>

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        <button 
          type="submit"
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
        >
          Login to Admin Panel
        </button>
      </form>
    </div>
  );
};
