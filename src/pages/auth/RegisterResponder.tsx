import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { readFunctionError } from '../../lib/functionError';
import { PHONE_PATTERN, PHONE_ERROR, normalizePhone } from '../../lib/phone';
import { User, Mail, Phone, Building2, Briefcase, IdCard, Loader2 } from 'lucide-react';
import {
  AuthLayout, AuthAlert, Field, FormSection, PasswordField, inputClass,
  AUTH_BTN_PRIMARY, PASSWORD_MIN,
} from '../../components/AuthLayout';

export const RegisterResponder = () => {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    contactNumber: '',
    organization: '',
    position: '',
    verificationInfo: '',
  });

  const [error, setError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [contactNumberError, setContactNumberError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // The submit button is at the bottom of a long form, so bring a server
  // error (shown above the form) into view instead of leaving it off-screen.
  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    errorRef.current?.focus({ preventScroll: true });
  }, [error]);
  const navigate = useNavigate();

  const update = (field: keyof typeof formData) => (value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    update('contactNumber')(normalizePhone(e.target.value));
    if (contactNumberError) setContactNumberError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setConfirmPasswordError(null);
    setContactNumberError(null);

    if (formData.contactNumber && !PHONE_PATTERN.test(formData.contactNumber)) {
      setContactNumberError(PHONE_ERROR);
      phoneRef.current?.focus();
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setConfirmPasswordError('Passwords do not match.');
      confirmRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const { data, error: registerError } = await supabase.functions.invoke('register', {
        body: {
          full_name: formData.fullName.trim(),
          email: formData.email.trim(),
          password: formData.password,
          contact_number: formData.contactNumber,
          organization: formData.organization.trim(),
          position: formData.position.trim(),
          verification_info: formData.verificationInfo.trim(),
          requested_role: 'bfp_responder',
        }
      });

      if (registerError) throw new Error(await readFunctionError(registerError, 'Registration failed. Please try again.'));
      if (data?.error) throw new Error(data.error);

      navigate('/pending-approval');
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      wide
      backToLogin
      title="Register as a responder"
      subtitle="For Bureau of Fire Protection (BFP) personnel who respond to AgapSense fire alerts. An administrator verifies your details before you can sign in."
    >
      {error && <AuthAlert ref={errorRef} tone="error" className="mb-6">{error}</AuthAlert>}

      <form onSubmit={handleSubmit} className="space-y-8">
        <FormSection title="Your details">
          <Field label="Full name" icon={User} required>
            {({ id }) => (
              <input
                id={id}
                type="text"
                required
                autoComplete="name"
                value={formData.fullName}
                onChange={(e) => update('fullName')(e.target.value)}
                className={inputClass()}
                placeholder="Juan Dela Cruz"
              />
            )}
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Email address" icon={Mail} required hint="Use your official BFP email if you have one.">
              {({ id, describedBy }) => (
                <input
                  id={id}
                  type="email"
                  required
                  autoComplete="email"
                  value={formData.email}
                  onChange={(e) => update('email')(e.target.value)}
                  aria-describedby={describedBy}
                  className={inputClass()}
                  placeholder="you@bfp.gov.ph"
                />
              )}
            </Field>

            <Field
              label="Mobile number"
              icon={Phone}
              hint="So the administrator can reach you about your request."
              error={contactNumberError}
            >
              {({ id, describedBy }) => (
                <input
                  ref={phoneRef}
                  id={id}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={formData.contactNumber}
                  onChange={handlePhoneChange}
                  aria-invalid={!!contactNumberError || undefined}
                  aria-describedby={describedBy}
                  className={inputClass(!!contactNumberError)}
                  placeholder="09XX XXX XXXX"
                />
              )}
            </Field>
          </div>
        </FormSection>

        <FormSection title="Station and verification">
          <Field label="Fire station" icon={Building2} required>
            {({ id }) => (
              <input
                id={id}
                type="text"
                required
                autoComplete="organization"
                value={formData.organization}
                onChange={(e) => update('organization')(e.target.value)}
                className={inputClass()}
                placeholder="e.g. BFP Malolos City Fire Station"
              />
            )}
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Rank or position" icon={Briefcase}>
              {({ id }) => (
                <input
                  id={id}
                  type="text"
                  autoComplete="organization-title"
                  value={formData.position}
                  onChange={(e) => update('position')(e.target.value)}
                  className={inputClass()}
                  placeholder="e.g. Fire Officer 1"
                />
              )}
            </Field>

            <Field label="BFP ID number" icon={IdCard} hint="Helps the administrator verify you faster.">
              {({ id, describedBy }) => (
                <input
                  id={id}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={formData.verificationInfo}
                  onChange={(e) => update('verificationInfo')(e.target.value)}
                  aria-describedby={describedBy}
                  className={inputClass()}
                  placeholder="Badge or employee ID"
                />
              )}
            </Field>
          </div>
        </FormSection>

        <FormSection title="Password">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <PasswordField
              label="Password"
              value={formData.password}
              onChange={update('password')}
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              hint={`At least ${PASSWORD_MIN} characters.`}
            />
            <PasswordField
              label="Confirm password"
              inputRef={confirmRef}
              value={formData.confirmPassword}
              onChange={(v) => { update('confirmPassword')(v); if (confirmPasswordError) setConfirmPasswordError(null); }}
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              error={confirmPasswordError}
            />
          </div>
        </FormSection>

        <div className="space-y-4">
          <button type="submit" disabled={loading} className={AUTH_BTN_PRIMARY}>
            {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Submitting…</> : 'Submit registration'}
          </button>
          <p className="text-center text-sm text-[#534341]">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-primary hover:underline">Sign in</Link>
          </p>
        </div>
      </form>
    </AuthLayout>
  );
};
