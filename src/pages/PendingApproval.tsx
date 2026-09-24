import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle2, ArrowLeft, AlertTriangle } from 'lucide-react';

export const PendingApproval = () => {
  const location = useLocation();
  const deviceCodeUnrecognized = (location.state as { deviceCodeUnrecognized?: boolean } | null)?.deviceCodeUnrecognized;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#FCF9F8] p-4 font-['Inter',_sans-serif]">
      <div className="bg-white p-10 rounded-[12px] shadow-[0_24px_48px_rgba(0,0,0,0.08)] border border-[#E5E2E1] max-w-lg w-full text-center">
        <div className="w-20 h-20 bg-[#E0F2FE] rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-10 h-10 text-[#00799C]" />
        </div>
        
        <h2 className="text-3xl font-black text-[#231918] mb-4 tracking-[-0.025em]">
          Registration Submitted
        </h2>
        
        <p className="text-[#534341] text-base leading-relaxed mb-8">
          Your account request has been successfully submitted and is currently <span className="font-bold">pending admin approval</span>. 
          You will be able to log in once your account details have been verified by an administrator.
        </p>

        {deviceCodeUnrecognized && (
          <div className="flex items-start gap-2 text-left bg-[#FEF3C7] text-[#92400E] text-sm p-4 rounded-lg mb-8">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>We don't recognize the device code you entered yet. That's fine if your device hasn't been set up - an administrator will confirm it during review.</span>
          </div>
        )}

        <Link
          to="/login"
          className="inline-flex items-center justify-center gap-2 w-full py-4 bg-[#F1E5E4] text-[#D32F2F] font-bold text-sm tracking-[0.1em] uppercase rounded-lg hover:bg-[#EBE0DF] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Return to Login
        </Link>
      </div>
    </div>
  );
};
