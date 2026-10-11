import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, LogIn } from 'lucide-react';

export const SessionExpired = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F4F4F5] flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white border border-[#E4E4E7] rounded-lg p-8 text-center shadow-sm">
        <div className="w-16 h-16 bg-[#FEE2E2] rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-8 h-8 text-[#DC2626]" />
        </div>
        
        <h1 className="text-2xl font-black text-[#18181B] mb-2">Session Expired</h1>
        <p className="text-[#52525B] text-sm mb-8">
          For your security, your session has timed out due to inactivity. Please sign in again to continue.
        </p>

        <button
          onClick={() => navigate('/login')}
          className="w-full flex items-center justify-center gap-2 bg-[#B91C1C] text-white py-3 px-4 rounded-lg font-bold text-sm hover:bg-[#DC2626] transition-colors"
        >
          <LogIn className="w-4 h-4" />
          Return to Login
        </button>
      </div>
    </div>
  );
};