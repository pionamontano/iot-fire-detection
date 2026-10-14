import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { AuthLayout, AuthAlert, PasswordField, AUTH_BTN_PRIMARY, PASSWORD_MIN } from '../../components/AuthLayout';

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

    if (password.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters long.`);
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
    <AuthLayout
      backToLogin
      title="Set a new password"
      subtitle="Choose a new password for your AgapSense account."
    >
      {error && <AuthAlert tone="error" className="mb-6">{error}</AuthAlert>}

      {done ? (
        <AuthAlert tone="success">
          Your password has been updated. Taking you to sign in&hellip;
        </AuthAlert>
      ) : linkInvalid ? (
        <AuthAlert tone="error">
          This password reset link is invalid or has expired.{' '}
          <Link to="/forgot-password" className="font-bold underline">Request a new link</Link>
        </AuthAlert>
      ) : !ready ? (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <p className="text-sm text-[#534341]">Checking your reset link&hellip;</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <PasswordField
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={PASSWORD_MIN}
            hint={`At least ${PASSWORD_MIN} characters.`}
          />
          <PasswordField
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            minLength={PASSWORD_MIN}
          />

          <button type="submit" disabled={loading} className={`${AUTH_BTN_PRIMARY} mt-2`}>
            {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</> : 'Update password'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
};
