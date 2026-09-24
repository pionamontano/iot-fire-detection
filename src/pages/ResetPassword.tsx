import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export const ResetPassword = () => {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
      }
    });

    // If the recovery link already produced a session before this listener
    // was attached (e.g. detectSessionInUrl resolved before mount), fall back
    // to checking for a session directly.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setReady(true);
      } else {
        setTimeout(() => {
          supabase.auth.getSession().then(({ data: retryData }) => {
            if (retryData.session) {
              setReady(true);
            } else {
              setLinkInvalid(true);
            }
          });
        }, 2000);
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message || 'Something went wrong. Please try again.');
      return;
    }

    setDone(true);
    await supabase.auth.signOut();
    setTimeout(() => navigate('/login'), 3000);
  };

  return (
    <div className="min-h-screen relative flex flex-col items-center justify-center p-4 lg:p-8 font-['Inter',_sans-serif] overflow-x-hidden">
      <div
        className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url(/login_bg.png)', filter: 'blur(8px)', transform: 'scale(1.05)' }}
      />
      <div className="fixed inset-0 z-0 bg-[#4D2120]/70 mix-blend-multiply" />
      <div className="fixed inset-0 z-0 bg-black/30" />

      <div className="relative z-10 w-full max-w-md flex flex-col items-center my-8">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="flex items-center gap-3 mb-6">
            <svg width="28" height="35" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 0C12 0 4 8 4 16C4 20.4183 7.58172 24 12 24C16.4183 24 20 20.4183 20 16C20 8 12 0 12 0Z" fill="#D32F2F"/>
              <path d="M12 12C12 12 8 16 8 20C8 22.2091 9.79086 24 12 24C14.2091 24 16 22.2091 16 20C16 16 12 12 12 12Z" fill="#FF8A65"/>
            </svg>
            <span className="text-white font-black text-3xl tracking-[-0.05em] uppercase">AgapSense</span>
          </div>
          <h1 className="font-black text-[32px] leading-tight text-white tracking-[-0.025em] mb-3">
            Set New Password
          </h1>
          <p className="text-white/80 text-sm font-medium">
            Choose a new password for your account.
          </p>
        </div>

        <div className="w-full bg-white rounded-2xl shadow-[0_24px_48px_rgba(0,0,0,0.2)] p-8 lg:p-10 border border-[#E5E2E1]">
          <Link to="/login" className="inline-flex items-center text-[#534341] hover:text-[#D32F2F] text-xs font-bold mb-6 transition-colors uppercase tracking-wider">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Login
          </Link>

          {error && (
            <div className="mb-6 p-4 bg-[#FEF2F2] border border-[#F87171] rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-[#DC2626] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[#991B1B] font-medium leading-relaxed">{error}</p>
            </div>
          )}

          {done ? (
            <div className="p-4 bg-[#F0FDF4] border border-[#86EFAC] rounded-lg flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#16A34A] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[#166534] font-medium leading-relaxed">
                Your password has been updated. Redirecting you to log in&hellip;
              </p>
            </div>
          ) : linkInvalid ? (
            <div className="p-4 bg-[#FEF2F2] border border-[#F87171] rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-[#DC2626] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[#991B1B] font-medium leading-relaxed">
                This password reset link is invalid or has expired. Please request a new one.
                <br />
                <Link to="/forgot-password" className="underline font-bold">Request a new link</Link>
              </p>
            </div>
          ) : !ready ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="w-6 h-6 text-[#D32F2F] animate-spin" />
              <p className="text-sm text-[#534341]">Verifying your reset link&hellip;</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-[#534341] uppercase tracking-wider mb-2">
                  New Password <span className="text-[#D32F2F]">*</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8D7F7D]" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg text-sm text-[#231918] placeholder-[#8D7F7D] focus:outline-none focus:border-[#D32F2F] focus:ring-1 focus:ring-[#D32F2F] transition-colors"
                    placeholder="At least 8 characters"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#534341] uppercase tracking-wider mb-2">
                  Confirm New Password <span className="text-[#D32F2F]">*</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8D7F7D]" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg text-sm text-[#231918] placeholder-[#8D7F7D] focus:outline-none focus:border-[#D32F2F] focus:ring-1 focus:ring-[#D32F2F] transition-colors"
                    placeholder="Re-enter your new password"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center py-3.5 px-4 bg-[#D32F2F] text-white font-bold text-sm tracking-[0.1em] uppercase rounded-lg hover:bg-[#B91C1C] focus:ring-4 focus:ring-[#FEF2F2] transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-[0_4px_12px_rgba(211,47,47,0.2)]"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Update Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
