import React from 'react';
import { ArrowLeft, Mail, Phone, MapPin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const Contact = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-white p-4 shadow-sm flex items-center gap-4 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full">
          <ArrowLeft size={24} />
        </button>
        <h1 className="font-bold text-lg">Contact Us</h1>
      </div>
      <div className="p-4 space-y-6">
        <div className="bg-white p-6 rounded-xl shadow-sm text-center">
          <h2 className="text-xl font-bold text-green-600 mb-2">Get in Touch</h2>
          <p className="text-gray-500 text-sm">We'd love to hear from you. Our team is always here to chat.</p>
        </div>

        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center text-green-600">
              <Mail size={20} />
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase font-bold">Email</p>
              <p className="font-medium">support@freshveggie.com</p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-600">
              <Phone size={20} />
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase font-bold">Phone</p>
              <p className="font-medium">+91 98765 43210</p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 bg-orange-50 rounded-full flex items-center justify-center text-orange-600">
              <MapPin size={20} />
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase font-bold">Office</p>
              <p className="font-medium">123, Green Street, Veggie Town, India</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
