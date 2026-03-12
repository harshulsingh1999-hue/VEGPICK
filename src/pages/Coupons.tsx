import React from 'react';
import { Tag, Copy } from 'lucide-react';
import { useToast } from '../context/ToastContext';

export const Coupons = () => {
  const { showToast } = useToast();

  const coupons = [
    { code: 'FRESH20', description: 'Get 20% OFF on your order', minOrder: 0 },
    { code: 'WELCOME50', description: 'Flat ₹50 OFF on your first order', minOrder: 200 },
    { code: 'VEGGIE10', description: '10% OFF on Leafy Greens', minOrder: 100 },
  ];

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    showToast(`Coupon ${code} copied to clipboard!`, 'success');
  };

  return (
    <div className="pb-24 pt-4 px-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Available Coupons</h1>

      <div className="space-y-4">
        {coupons.map((coupon) => (
          <div key={coupon.code} className="bg-white p-4 rounded-xl shadow-sm border border-dashed border-green-300 flex justify-between items-center relative overflow-hidden">
            <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-gray-50 rounded-full"></div>
            <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-gray-50 rounded-full"></div>
            
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-lg text-gray-800">{coupon.code}</span>
                <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded">ACTIVE</span>
              </div>
              <p className="text-sm text-gray-600">{coupon.description}</p>
              {coupon.minOrder > 0 && (
                <p className="text-xs text-gray-400 mt-1">Min Order: ₹{coupon.minOrder}</p>
              )}
            </div>

            <button 
              onClick={() => copyCode(coupon.code)}
              className="p-2 text-gray-400 hover:text-green-600"
            >
              <Copy size={20} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
