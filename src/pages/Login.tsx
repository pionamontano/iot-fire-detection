import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export const Login = () => {
  const navigate = useNavigate();
  const { session, profile } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockoutTimer, setLockoutTimer] = useState(0);
  const [rememberMe, setRememberMe] = useState(false);
  const [scale, setScale] = useState(1);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const updateScale = () => {
      const lg = window.innerWidth >= 1024;
      setIsDesktop(lg);
      if (lg) {
        const padding = 48;
        const targetWidth = 1152;
        const targetHeight = 726;
        const scaleX = (window.innerWidth - padding) / targetWidth;
        const scaleY = (window.innerHeight - padding) / targetHeight;
        setScale(Math.min(scaleX, scaleY, 1)); // cap at 1 so it never scales UP
      } else {
        setScale(1);
      }
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (lockoutTimer > 0) {
      interval = setInterval(() => {
        setLockoutTimer((prev) => {
          if (prev <= 1) setLocked(false);
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [lockoutTimer]);

  useEffect(() => {
    if (session && profile) {
      if (profile.role === 'admin') navigate('/dashboard', { replace: true });
      else if (profile.role === 'bfp_responder') navigate('/responder', { replace: true });
      else if (profile.role === 'resident') navigate('/home', { replace: true });
    }
  }, [session, profile, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Real, server-backed rate limit check (login_attempts-based) -
    // replaces the old in-memory-only failures counter, which reset
    // on every page refresh and never actually blocked anything.
    const { data: lockoutData } = await supabase.rpc('check_login_lockout', { p_email: email });
    const lockoutStatus = lockoutData?.[0];
    if (lockoutStatus?.locked) {
      setLocked(true);
      setLockoutTimer(lockoutStatus.retry_after_seconds);
      setError('Too many failed attempts. Please wait before trying again.');
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    await supabase.from('login_attempts').insert({ email, success: !error });

    if (error) {
      setError(error.message || 'Incorrect email or password. Try again.');

      const { data: newLockoutData } = await supabase.rpc('check_login_lockout', { p_email: email });
      const newLockoutStatus = newLockoutData?.[0];
      if (newLockoutStatus?.locked) {
        setLocked(true);
        setLockoutTimer(newLockoutStatus.retry_after_seconds);
      }

      setLoading(false);
    }
  };

  const ShieldIcon = ({ className }: { className?: string }) => (
    <svg className={className} width="14" height="17" viewBox="0 0 14 17" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.80002 17C4.83084 16.5042 3.20522 15.3744 1.92313 13.6107C0.641043 11.8469 0 9.88836 0 7.73502V2.55001L6.80002 0L13.6 2.55001V7.73502C13.6 9.88836 12.959 11.8469 11.6769 13.6107C10.3948 15.3744 8.76919 16.5042 6.80002 17ZM6.80002 15.215C8.17419 14.79 9.32169 13.9507 10.2425 12.6969C11.1634 11.4432 11.7017 10.0442 11.8575 8.50002H6.80002V1.80625L1.7 3.71876V7.73502C1.7 7.89085 1.7 8.01835 1.7 8.11752C1.7 8.21669 1.71417 8.34419 1.7425 8.50002H6.80002V15.215Z" fill="currentColor"/>
    </svg>
  );

  if (locked && lockoutTimer >= 900) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface p-4" style={{ fontFamily: "'Inter', sans-serif" }}>
        <div className="max-w-md w-full bg-white p-8 rounded-xl shadow-[0_24px_48px_rgba(0,0,0,0.08)] border border-border text-center">
          <div className="w-16 h-16 bg-[#F1E5E4] rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldIcon className="text-[#D32F2F] w-8 h-10" />
          </div>
          <h2 className="text-2xl font-extrabold text-[#D32F2F] mb-2 tracking-[-0.025em]">Account Locked</h2>
          <p className="text-[#534341] text-sm leading-[18.2px]">
            This account has been temporarily locked due to too many failed attempts.
            Contact your administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`w-full flex items-center justify-center ${isDesktop ? 'h-screen overflow-hidden' : 'min-h-screen overflow-y-auto p-4'}`}
      style={{ fontFamily: "'Inter', sans-serif", background: '#FCF9F8' }}
    >
      {/* Main Card */}
      <div 
        className={`bg-white rounded-[12px] shadow-[0_24px_48px_rgba(0,0,0,0.08)] overflow-hidden shrink-0 ${
          isDesktop
            ? 'w-[1152px] h-[726px] grid grid-cols-12 origin-center'
            : 'w-full max-w-[1152px] grid grid-cols-1'
        }`}
        style={isDesktop ? { transform: `scale(${scale})` } : undefined}
      >

        {/* ──────── LEFT: Branding / Identity Side ──────── */}
        <div
          className={`relative flex flex-col overflow-hidden ${
            isDesktop
              ? 'col-span-7 justify-between p-12'
              : 'col-span-1 justify-center p-8 min-h-[220px]'
          }`}
          style={{ background: '#4D2120' }}
        >
          {/* Background image at 40% opacity */}
          <div className="absolute inset-0 opacity-40">
            <img
              src="/login_bg.png"
              alt=""
              className="w-full h-full object-cover"
            />
          </div>

          {/* Content (above the bg image) */}
          <div className="relative z-10 flex flex-col gap-6">
            {/* Logo row */}
            <div className="flex items-center gap-3">
              {/* Fire icon */}
              <svg width="24" height="30" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 0C12 0 4 8 4 16C4 20.4183 7.58172 24 12 24C16.4183 24 20 20.4183 20 16C20 8 12 0 12 0Z" fill="#D32F2F"/>
                <path d="M12 12C12 12 8 16 8 20C8 22.2091 9.79086 24 12 24C14.2091 24 16 22.2091 16 20C16 16 12 12 12 12Z" fill="#FF8A65"/>
              </svg>
              <span className="text-white font-black text-2xl tracking-[-0.05em] uppercase">
                AgapSense
              </span>
            </div>

            {/* Hero headline */}
            <div className="max-w-[448px]">
              <h1 className="font-black text-[48px] leading-[60px] tracking-[-0.025em] text-white">
                Smarter detection,
                <br />
                <span className="text-[#D32F2F]">faster response.</span>
              </h1>
            </div>
          </div>

          {/* Spacer for bottom (justify-between pushes content up) */}
          <div></div>
        </div>

        {/* ──────── RIGHT: Login Form Side ──────── */}
        <div
          className={`flex flex-col justify-center overflow-y-auto scrollbar-hide ${
            isDesktop ? 'col-span-5 p-12' : 'col-span-1 p-8'
          }`}
          style={{ background: '#FFF8F7' }}
        >
          {/* Header */}
          <div className="pb-10">
            <div className="flex flex-col gap-2">
              <h2 className="text-[#231918] font-bold text-2xl leading-8 tracking-[-0.025em]">
                System Authentication
              </h2>
              <p className="text-[#534341] text-sm leading-5">
                Enter your credentials to access the sensor network.
              </p>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-[#F1E5E4] border-l-4 border-[#D32F2F] text-[#534341] p-3 rounded-lg mb-4 text-sm">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="pb-4">
            <div className="flex flex-col gap-6">
              {/* Email Field */}
              <div className="flex flex-col gap-2">
                <label className="text-[#857371] text-xs font-normal tracking-[0.1em] uppercase leading-4">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10 20C8.61667 20 7.31667 19.7375 6.1 19.2125C4.88333 18.6875 3.825 17.975 2.925 17.075C2.025 16.175 1.3125 15.1167 0.7875 13.9C0.2625 12.6833 0 11.3833 0 10C0 8.61667 0.2625 7.31667 0.7875 6.1C1.3125 4.88333 2.025 3.825 2.925 2.925C3.825 2.025 4.88333 1.3125 6.1 0.7875C7.31667 0.2625 8.61667 0 10 0C11.3833 0 12.6833 0.2625 13.9 0.7875C15.1167 1.3125 16.175 2.025 17.075 2.925C17.975 3.825 18.6875 4.88333 19.2125 6.1C19.7375 7.31667 20 8.61667 20 10V11.45C20 12.4333 19.6625 13.2708 18.9875 13.9625C18.3125 14.6542 17.4833 15 16.5 15C15.9167 15 15.3667 14.875 14.85 14.625C14.3333 14.375 13.9 14.0167 13.55 13.55C13.0667 14.0333 12.5208 14.3958 11.9125 14.6375C11.3042 14.8792 10.6667 15 10 15C8.61667 15 7.4375 14.5125 6.4625 13.5375C5.4875 12.5625 5 11.3833 5 10C5 8.61667 5.4875 7.4375 6.4625 6.4625C7.4375 5.4875 8.61667 5 10 5C11.3833 5 12.5625 5.4875 13.5375 6.4625C14.5125 7.4375 15 8.61667 15 10V11.45C15 11.8833 15.1417 12.25 15.425 12.55C15.7083 12.85 16.0667 13 16.5 13C16.9333 13 17.2917 12.85 17.575 12.55C17.8583 12.25 18 11.8833 18 11.45V10C18 7.76667 17.225 5.875 15.675 4.325C14.125 2.775 12.2333 2 10 2C7.76667 2 5.875 2.775 4.325 4.325C2.775 5.875 2 7.76667 2 10C2 12.2333 2.775 14.125 4.325 15.675C5.875 17.225 7.76667 18 10 18H15V20H10ZM10 13C10.8333 13 11.5417 12.7083 12.125 12.125C12.7083 11.5417 13 10.8333 13 10C13 9.16667 12.7083 8.45833 12.125 7.875C11.5417 7.29167 10.8333 7 10 7C9.16667 7 8.45833 7.29167 7.875 7.875C7.29167 8.45833 7 9.16667 7 10C7 10.8333 7.29167 11.5417 7.875 12.125C8.45833 12.7083 9.16667 13 10 13Z" fill="#857371"/>
                    </svg>
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#EBE0DF] rounded-t-[8px] rounded-b-none border-0 pl-12 pr-4 py-[18px] text-base text-[#231918] placeholder-[rgba(83,67,65,0.5)] focus:outline-none focus:ring-2 focus:ring-[#D32F2F]/30"
                    placeholder="name@organization.com"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-[#857371] text-xs font-normal tracking-[0.1em] uppercase leading-4">
                    Password
                  </label>
                </div>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center">
                    <svg width="16" height="21" viewBox="0 0 16 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M2 21C1.45 21 0.979167 20.8042 0.5875 20.4125C0.195833 20.0208 0 19.55 0 19V9C0 8.45 0.195833 7.97917 0.5875 7.5875C0.979167 7.19583 1.45 7 2 7H3V5C3 3.61667 3.4875 2.4375 4.4625 1.4625C5.4375 0.4875 6.61667 0 8 0C9.38333 0 10.5625 0.4875 11.5375 1.4625C12.5125 2.4375 13 3.61667 13 5V7H14C14.55 7 15.0208 7.19583 15.4125 7.5875C15.8042 7.97917 16 8.45 16 9V19C16 19.55 15.8042 20.0208 15.4125 20.4125C15.0208 20.8042 14.55 21 14 21H2ZM2 19H14V9H2V19ZM8 16C8.55 16 9.02083 15.8042 9.4125 15.4125C9.80417 15.0208 10 14.55 10 14C10 13.45 9.80417 12.9792 9.4125 12.5875C9.02083 12.1958 8.55 12 8 12C7.45 12 6.97917 12.1958 6.5875 12.5875C6.19583 12.9792 6 13.45 6 14C6 14.55 6.19583 15.0208 6.5875 15.4125C6.97917 15.8042 7.45 16 8 16ZM5 7H11V5C11 4.16667 10.7083 3.45833 10.125 2.875C9.54167 2.29167 8.83333 2 8 2C7.16667 2 6.45833 2.29167 5.875 2.875C5.29167 3.45833 5 4.16667 5 5V7ZM2 19V9V19Z" fill="#857371"/>
                    </svg>
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[#EBE0DF] rounded-t-[8px] rounded-b-none border-0 pl-12 pr-12 py-[18px] text-base text-[#231918] placeholder-[rgba(83,67,65,0.5)] focus:outline-none focus:ring-2 focus:ring-[#D32F2F]/30"
                    placeholder="••••••••••••"
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#857371] hover:text-[#534341] transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Remember Me */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="rememberMe"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border border-[#D8C2C0] bg-[#FFF8F7] accent-[#D32F2F] cursor-pointer"
                />
                <label htmlFor="rememberMe" className="text-[#534341] text-sm leading-5 cursor-pointer">
                  Keep me logged in on this terminal
                </label>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading || lockoutTimer > 0}
                className="relative w-full flex items-center justify-center gap-2 py-4 bg-[#D32F2F] text-white font-bold text-sm tracking-[0.1em] uppercase leading-5 rounded-lg shadow-[0_4px_6px_-4px_rgba(211,47,47,0.2),0_10px_15px_-3px_rgba(211,47,47,0.2)] hover:bg-[#B91C1C] transition-colors disabled:opacity-50"
              >
                <span>{loading ? 'Authenticating...' : 'Initialize Access'}</span>
                {!loading && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M7 14V12.4444H12.4444V1.55556H7V0H12.4444C12.8722 0 13.2384 0.152315 13.5431 0.456944C13.8477 0.761574 14 1.12778 14 1.55556V12.4444C14 12.8722 13.8477 13.2384 13.5431 13.5431C13.2384 13.8477 12.8722 14 12.4444 14H7ZM5.44444 10.8889L4.375 9.76111L6.35833 7.77778H0V6.22222H6.35833L4.375 4.23889L5.44444 3.11111L9.33333 7L5.44444 10.8889Z" fill="white"/>
                  </svg>
                )}
              </button>

              <div className="pt-6 mt-6 border-t border-[#E5E2E1]">
                <div className="flex flex-col gap-3">
                  <Link 
                    to="/register/resident" 
                    className="w-full flex justify-center py-3 px-4 bg-[#F1E5E4] text-[#D32F2F] font-bold text-sm tracking-[0.1em] uppercase rounded-lg hover:bg-[#EBE0DF] transition-colors"
                  >
                    Sign Up as Resident
                  </Link>
                  <Link 
                    to="/register/responder" 
                    className="w-full flex justify-center py-3 px-4 bg-[#E0F2FE] text-[#00799C] font-bold text-sm tracking-[0.1em] uppercase rounded-lg hover:bg-[#BAE6FD] transition-colors"
                  >
                    Request Responder Account
                  </Link>
                </div>
              </div>

              {lockoutTimer > 0 && (
                <div className="text-[#D32F2F] text-sm text-center font-bold">
                  Too many attempts. Wait {lockoutTimer} seconds before trying again.
                </div>
              )}

              <div className="text-center mt-2 group relative inline-block mx-auto">
                <button type="button" className="text-[#534341] text-xs hover:text-[#231918] transition-colors">
                  Forgot password?
                </button>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-[#231918] text-white text-[10px] rounded whitespace-nowrap pointer-events-none">
                  Contact your administrator to reset your password.
                </div>
              </div>
            </div>
          </form>

          {/* RBAC Notice */}
          <div className="mt-auto pt-6">
            <div className="bg-[#F1E5E4] border-l-4 border-[#D32F2F] rounded-lg p-4">
              <div className="flex gap-3">
                <div className="flex-shrink-0 pt-0.5">
                  <ShieldIcon className="text-[#D32F2F]" />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[#231918] text-xs font-bold tracking-[0.1em] uppercase leading-4">
                    RBAC Enforcement Notice
                  </span>
                  <p className="text-[#534341] text-[11.2px] leading-[18.2px]">
                    Access is restricted to authorized personnel. Role-Based
                    Access Control (RBAC) is active. All login attempts and
                    terminal interactions are logged for audit compliance.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Version Footer */}
          <div className="mt-8 text-center">
            <span className="text-[#857371] text-[10px] tracking-[0.1em] uppercase leading-[15px]">
              System Version 4.2.0-Alpha | Precision Response
            </span>
          </div>
        </div>
      </div>

    </div>
  );
};
