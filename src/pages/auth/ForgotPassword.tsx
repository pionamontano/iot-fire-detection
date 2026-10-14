import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { AuthLayout, AuthAlert, Field, inputClass, AUTH_BTN_PRIMARY, AUTH_BTN_SECONDARY } from '../../components/AuthLayout';

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
    <AuthLayout
      backToLogin
      title="Reset your password"
      subtitle="Enter the email for your account and we'll send you a link to set a new password."
    >
      {error && <AuthAlert tone="error" className="mb-6">{error}</AuthAlert>}

      {sent ? (
        <div className="space-y-6">
          <AuthAlert tone="success">
            If an account exists for <strong>{email}</strong>, we've sent a password reset link to it.
            Check your inbox (and spam folder) and follow the link to set a new password.
          </AuthAlert>
          <Link to="/login" className={AUTH_BTN_SECONDARY}>Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
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

          <button type="submit" disabled={loading} className={AUTH_BTN_PRIMARY}>
            {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Sending…</> : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
};
