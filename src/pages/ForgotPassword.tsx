import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    // Always show the same success state regardless of whether the email
    // matched an account - resetPasswordForEmail itself already does this
    // (no error for an unknown email), but we don't want a network/rate-limit
    // error to look identical to "check your email" either, so only genuine
    // request failures fall through to the error banner.
    if (resetError) {
      setError(resetError.message || 'Something went wrong. Please try again.');
      return;
    }

    setSent(true);
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
            Reset Password
          </h1>
          <p className="text-white/80 text-sm font-medium">
            Enter your account email and we'll send you a link to reset your password.
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

          {sent ? (
            <div className="p-4 bg-[#F0FDF4] border border-[#86EFAC] rounded-lg flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#16A34A] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[#166534] font-medium leading-relaxed">
                If an account exists for <strong>{email}</strong>, a password reset link has been sent.
                Check your inbox and follow the link to set a new password.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-[#534341] uppercase tracking-wider mb-2">
                  Email Address <span className="text-[#D32F2F]">*</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8D7F7D]" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg text-sm text-[#231918] placeholder-[#8D7F7D] focus:outline-none focus:border-[#D32F2F] focus:ring-1 focus:ring-[#D32F2F] transition-colors"
                    placeholder="name@organization.com"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center py-3.5 px-4 bg-[#D32F2F] text-white font-bold text-sm tracking-[0.1em] uppercase rounded-lg hover:bg-[#B91C1C] focus:ring-4 focus:ring-[#FEF2F2] transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-[0_4px_12px_rgba(211,47,47,0.2)]"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send Reset Link'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
