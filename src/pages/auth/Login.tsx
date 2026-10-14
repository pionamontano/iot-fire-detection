import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { House, Loader2, LogIn, Mail, ShieldAlert, Siren } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { readFunctionErrorBody } from '../../lib/functionError';
import { AuthLayout, AuthAlert, Field, PasswordField, inputClass, AUTH_BTN_PRIMARY, AUTH_BTN_SECONDARY } from '../../components/AuthLayout';

export const Login = () => {
  const navigate = useNavigate();
  const { session, profile } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockoutTimer, setLockoutTimer] = useState(0);
  const passwordRef = useRef<HTMLInputElement>(null);

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

  // AuthGuard sends signed-out visitors here with the page they asked for
  // (e.g. a support request opened from a notification). Return them to it;
  // AuthGuard still redirects if that page isn't allowed for their role.
  const from = (useLocation().state as { from?: Location } | null)?.from;
  const returnTo = from && from.pathname !== '/' && from.pathname !== '/login'
    ? `${from.pathname}${from.search}${from.hash}`
    : null;

  useEffect(() => {
    if (session && profile) {
      if (returnTo && profile.status === 'approved') navigate(returnTo, { replace: true });
      else if (profile.role === 'admin') navigate('/dashboard', { replace: true });
      else if (profile.role === 'bfp_responder') navigate('/responder', { replace: true });
      else if (profile.role === 'resident') navigate('/home', { replace: true });
    }
  }, [session, profile, navigate, returnTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Login goes through the `login` Edge Function rather than calling
    // supabase.auth.signInWithPassword() directly. That function checks
    // check_login_lockout and records the attempt server-side, with the
    // service role, so the lockout is actually enforced for this app's
    // own login page instead of being a client-side check a caller could
    // skip (which is exactly what made tiers past the first one
    // unreachable, and every attempt while "locked" a no-op instead of a
    // recorded failure).
    const { data, error: invokeError } = await supabase.functions.invoke('login', {
      body: { email, password },
    });

    if (invokeError) {
      const body = await readFunctionErrorBody(invokeError) as { error?: string; locked?: boolean; retry_after_seconds?: number } | null;
      setError(body?.error || invokeError.message || 'Incorrect email or password. Try again.');
      if (body?.locked) {
        setLocked(true);
        setLockoutTimer(body.retry_after_seconds || 0);
      }
      setLoading(false);
      // Keep the email and let them retype the password straight away.
      passwordRef.current?.focus();
      passwordRef.current?.select();
      return;
    }

    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });

    if (setSessionError) {
      setError('Something went wrong finishing sign-in. Please try again.');
      setLoading(false);
      return;
    }

    // On success, AuthContext's onAuthStateChange listener picks up the
    // adopted session and the redirect effect above fires once the
    // profile resolves - loading intentionally stays true until then,
    // matching the previous signInWithPassword-based behavior.
  };

  if (locked && lockoutTimer >= 900) {
    return (
      <AuthLayout title="Account temporarily locked">
        <AuthAlert tone="error">
          This account has been locked after too many failed sign-in attempts.
          Contact your AgapSense administrator to unlock it.
        </AuthAlert>
      </AuthLayout>
    );
  }

  const lockoutLabel = lockoutTimer >= 60
    ? `${Math.floor(lockoutTimer / 60)}:${String(lockoutTimer % 60).padStart(2, '0')}`
    : `${lockoutTimer} second${lockoutTimer === 1 ? '' : 's'}`;

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Enter the email and password for your AgapSense account."
    >
      {error && <AuthAlert tone="error" className="mb-6">{error}</AuthAlert>}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="Email address" icon={Mail} required>
          {({ id }) => (
            <input
              id={id}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass()}
              placeholder="you@example.com"
            />
          )}
        </Field>

        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          inputRef={passwordRef}
          minLength={6}
          placeholder="Enter your password"
          aside={
            <Link to="/forgot-password" className="text-sm font-semibold text-primary hover:text-primary-dark hover:underline">
              Forgot password?
            </Link>
          }
        />

        {lockoutTimer > 0 && (
          <p className="text-sm font-semibold text-tier2-text" role="status">
            Too many attempts. Try again in {lockoutLabel}.
          </p>
        )}

        <button type="submit" disabled={loading || lockoutTimer > 0} className={AUTH_BTN_PRIMARY}>
          {loading
            ? <><Loader2 className="w-5 h-5 animate-spin" /> Signing in…</>
            : <><LogIn className="w-4 h-4" /> Sign in</>}
        </button>
      </form>

      <div className="mt-8 pt-8 border-t border-border">
        <p className="text-sm font-semibold text-[#231918] mb-3">New to AgapSense?</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link to="/register/resident" className={AUTH_BTN_SECONDARY}>
            <House className="w-4 h-4 text-primary" /> Register as resident
          </Link>
          <Link to="/register/responder" className={AUTH_BTN_SECONDARY}>
            <Siren className="w-4 h-4 text-primary" /> Register as responder
          </Link>
        </div>
        <p className="mt-3 text-xs text-[#6B5856]">An administrator approves new accounts before first sign-in.</p>
      </div>

      <p className="mt-6 flex items-start gap-2 text-xs text-[#6B5856]">
        <ShieldAlert className="w-4 h-4 shrink-0" />
        Authorized users only. Repeated failed sign-ins lock the account.
      </p>
    </AuthLayout>
  );
};
