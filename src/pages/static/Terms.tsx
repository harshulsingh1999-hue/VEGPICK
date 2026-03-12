import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const Terms = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-white p-4 shadow-sm flex items-center gap-4 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full">
          <ArrowLeft size={24} />
        </button>
        <h1 className="font-bold text-lg">Terms & Conditions</h1>
      </div>
      <div className="p-4 prose prose-sm max-w-none">
        <h3>1. Agreement to Terms</h3>
        <p>By accessing our app, you agree to be bound by these Terms and Conditions.</p>
        
        <h3>2. Use License</h3>
        <p>Permission is granted to temporarily download one copy of the materials on FreshVeggie's app for personal, non-commercial transitory viewing only.</p>
        
        <h3>3. Disclaimer</h3>
        <p>The materials on FreshVeggie's app are provided on an 'as is' basis. FreshVeggie makes no warranties, expressed or implied, and hereby disclaims and negates all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.</p>
        
        <h3>4. Limitations</h3>
        <p>In no event shall FreshVeggie or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the materials on FreshVeggie's app.</p>
      </div>
    </div>
  );
};
