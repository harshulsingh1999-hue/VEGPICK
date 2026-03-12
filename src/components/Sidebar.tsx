import React from 'react';
import { Link } from 'react-router-dom';
import { X, User, Truck, FileText, Shield, Phone, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-50 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div className={`fixed top-0 left-0 h-full w-64 bg-white z-50 transform transition-transform duration-300 ease-in-out shadow-xl ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-5 flex justify-between items-center border-b border-gray-100">
          <h2 className="font-bold text-xl text-green-600">FreshVeggie</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 text-gray-500">
            <X size={24} />
          </button>
        </div>

        <div className="p-4">
          {user ? (
            <div className="mb-6 p-4 bg-green-50 rounded-xl">
              <p className="font-bold text-gray-800">{user.name}</p>
              <p className="text-sm text-gray-500">{user.phone}</p>
            </div>
          ) : (
             <div className="mb-6 p-4 bg-gray-50 rounded-xl">
              <p className="font-bold text-gray-800">Guest User</p>
              <Link to="/profile" onClick={onClose} className="text-sm text-green-600 font-medium">Login / Register</Link>
            </div>
          )}

          <nav className="space-y-1">
            <Link to="/profile" onClick={onClose} className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg">
              <User size={20} className="text-gray-400" />
              <span>User Account</span>
            </Link>
            
            <Link to="/delivery/login" onClick={onClose} className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg">
              <Truck size={20} className="text-gray-400" />
              <span>Delivery Partner</span>
            </Link>

            <Link to="/admin/login" onClick={onClose} className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg">
              <Shield size={20} className="text-blue-500" />
              <span className="font-medium text-blue-600">Admin Panel</span>
            </Link>

            <div className="my-2 border-t border-gray-100"></div>

            <Link to="/disclaimer" onClick={onClose} className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg">
              <AlertCircle size={20} className="text-gray-400" />
              <span>Disclaimer</span>
            </Link>

            <Link to="/terms" onClick={onClose} className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg">
              <FileText size={20} className="text-gray-400" />
              <span>Terms & Conditions</span>
            </Link>

            <Link to="/policy" onClick={onClose} className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg">
              <Shield size={20} className="text-gray-400" />
              <span>Privacy Policy</span>
            </Link>

            <Link to="/contact" onClick={onClose} className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg">
              <Phone size={20} className="text-gray-400" />
              <span>Contact Us</span>
            </Link>
          </nav>
        </div>
        
        <div className="absolute bottom-0 left-0 w-full p-4 border-t border-gray-100 text-center text-xs text-gray-400">
          v1.0.0 • Made with ❤️
        </div>
      </div>
    </>
  );
};
