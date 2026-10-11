import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { CheckCircle2 } from 'lucide-react';

export const ResidentSetup = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [mobile, setMobile] = useState('');
  const [confirmMobile, setConfirmMobile] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // If setup is already complete, redirect to home
    if (profile?.setup_complete) {
      navigate('/home', { replace: true });
    }
  }, [profile, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    // Validate format
    const phoneRegex = /^(09\d{9})$/;
    if (!phoneRegex.test(mobile)) {
      setError('Enter a valid Philippine mobile number (e.g. 09171234567).');
      return;
    }
    
    if (mobile !== confirmMobile) {
      setError('Numbers do not match. Please re-enter.');
      return;
    }
    
    if (!profile) return;

    setLoading(true);
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          contact_number: mobile,
          setup_complete: true
        })
        .eq('id', profile.id);

      if (updateError) throw updateError;
      
      setSuccess(true);
      setTimeout(() => {
        // We might want to reload the window to refresh the auth context completely,
        // or just navigate and let the context update based on realtime if we have it.
        window.location.href = '/home';
      }, 1500);
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to update contact number');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-[#FCF9F8] px-4 font-['Inter',_sans-serif]">
      <div className="max-w-md w-full flex flex-col gap-6">
        <div className="text-center flex flex-col gap-2">
          <span className="text-[#857371] text-xs font-bold tracking-[0.1em] uppercase">
            Setup (1 of 1)
          </span>
          <h2 className="text-[#231918] font-black text-2xl tracking-tight">
            Set up your alert contact
          </h2>
          <p className="text-[#534341] text-sm leading-5">
            Bantay Apoy sends SMS alerts directly to your phone during a fire event. Enter the mobile number you want to receive these alerts on.
          </p>
        </div>

        <div className="bg-white p-8 rounded-xl shadow-[0_24px_48px_rgba(0,0,0,0.08)] border border-[#E5E2E1]">
          {success ? (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <div className="w-16 h-16 bg-[#E0F2FE] rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-[#00799C]" />
              </div>
              <p className="text-[#00799C] font-bold text-center">
                Contact saved. Taking you to your dashboard...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-[#857371] text-xs font-bold tracking-[0.1em] uppercase">
                  Mobile number
                </label>
                <input
                  type="tel"
                  required
                  maxLength={11}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                  placeholder="09XXXXXXXXX"
                  className="w-full bg-[#FCF9F8] border border-[#E5E2E1] rounded-md px-4 py-3 text-base text-[#231918] placeholder-[rgba(83,67,65,0.5)] focus:outline-none focus:ring-2 focus:ring-[#D32F2F]/30 focus:border-[#D32F2F] transition-all"
                />
                <span className="text-[10px] text-[#A1A1AA]">
                  Philippine number only — e.g. 09171234567
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[#857371] text-xs font-bold tracking-[0.1em] uppercase">
                  Confirm mobile number
                </label>
                <input
                  type="tel"
                  required
                  maxLength={11}
                  value={confirmMobile}
                  onChange={(e) => setConfirmMobile(e.target.value.replace(/\D/g, ''))}
                  placeholder="Re-enter your number"
                  className={`w-full bg-[#FCF9F8] border rounded-md px-4 py-3 text-base text-[#231918] placeholder-[rgba(83,67,65,0.5)] focus:outline-none focus:ring-2 transition-all ${
                    error ? 'border-[#D32F2F] focus:ring-[#D32F2F]/30' : 'border-[#E5E2E1] focus:border-[#D32F2F] focus:ring-[#D32F2F]/30'
                  }`}
                />
                {error && (
                  <span className="text-[#D32F2F] text-[11px] font-bold mt-1">
                    {error}
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-4 bg-[#D32F2F] text-white font-bold text-sm tracking-[0.1em] uppercase rounded-lg shadow-[0_4px_6px_-4px_rgba(211,47,47,0.2),0_10px_15px_-3px_rgba(211,47,47,0.2)] hover:bg-[#B91C1C] transition-colors disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save and continue'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};