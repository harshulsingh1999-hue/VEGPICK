import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const Policy = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-white p-4 shadow-sm flex items-center gap-4 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full">
          <ArrowLeft size={24} />
        </button>
        <h1 className="font-bold text-lg">Privacy Policy</h1>
      </div>
      <div className="p-4 prose prose-sm max-w-none">
        <p>Your privacy is important to us. It is FreshVeggie's policy to respect your privacy regarding any information we may collect from you across our app.</p>
        
        <h3>Information We Collect</h3>
        <p>We only ask for personal information when we truly need it to provide a service to you. We collect it by fair and lawful means, with your knowledge and consent. We also let you know why we're collecting it and how it will be used.</p>
        
        <h3>Data Retention</h3>
        <p>We only retain collected information for as long as necessary to provide you with your requested service. What data we store, we'll protect within commercially acceptable means to prevent loss and theft, as well as unauthorized access, disclosure, copying, use or modification.</p>
        
        <h3>Sharing</h3>
        <p>We don't share any personally identifying information publicly or with third-parties, except when required to by law.</p>
      </div>
    </div>
  );
};
