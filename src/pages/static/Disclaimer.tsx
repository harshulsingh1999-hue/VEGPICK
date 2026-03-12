import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const Disclaimer = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-white p-4 shadow-sm flex items-center gap-4 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full">
          <ArrowLeft size={24} />
        </button>
        <h1 className="font-bold text-lg">Disclaimer</h1>
      </div>
      <div className="p-4 prose prose-sm max-w-none">
        <p>The information provided by FreshVeggie ("we," "us," or "our") on our mobile application is for general informational purposes only. All information on the mobile application is provided in good faith, however we make no representation or warranty of any kind, express or implied, regarding the accuracy, adequacy, validity, reliability, availability or completeness of any information on our mobile application.</p>
        <p>Under no circumstance shall we have any liability to you for any loss or damage of any kind incurred as a result of the use of the mobile application or reliance on any information provided on the mobile application. Your use of the mobile application and your reliance on any information on the mobile application is solely at your own risk.</p>
      </div>
    </div>
  );
};
