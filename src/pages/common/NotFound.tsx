import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { AlertCircle } from 'lucide-react';

export const NotFound = () => {
  const navigate = useNavigate();
  const { session, profile } = useAuth();

  const handleRedirect = () => {
    if (!session || !profile) {
      navigate('/login');
      return;
    }
    
    if (profile.role === 'admin') navigate('/dashboard');
    else if (profile.role === 'bfp_responder') navigate('/responder');
    else if (profile.role === 'resident') navigate('/home');
    else navigate('/login');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FCF9F8] p-4 font-['Inter',_sans-serif]">
      <div className="max-w-md w-full bg-white p-10 rounded-xl shadow-[0_24px_48px_rgba(0,0,0,0.08)] border border-[#E5E2E1] text-center flex flex-col items-center gap-6">
        <div className="w-16 h-16 bg-[#FEE2E2] rounded-full flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-[#D32F2F]" />
        </div>
        
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-black tracking-tight text-[#231918]">Page not found</h2>
          <p className="text-[#534341] text-sm leading-relaxed">
            This page doesn't exist or you don't have permission to view it.
          </p>
        </div>

        <button
          onClick={handleRedirect}
          className="w-full mt-2 py-4 bg-[#D32F2F] text-white font-bold text-sm tracking-[0.1em] uppercase rounded-lg shadow-[0_4px_6px_-4px_rgba(211,47,47,0.2),0_10px_15px_-3px_rgba(211,47,47,0.2)] hover:bg-[#B91C1C] transition-colors"
        >
          Go to dashboard
        </button>
      </div>
    </div>
  );
};