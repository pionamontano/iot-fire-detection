import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { readFunctionError } from '../../lib/functionError';
import { User, Mail, Phone, MapPin, Cpu, Loader2 } from 'lucide-react';
import {
  AuthLayout, AuthAlert, Field, FormSection, PasswordField, inputClass,
  AUTH_BTN_PRIMARY, PHONE_PATTERN, PHONE_ERROR, PASSWORD_MIN,
} from '../../components/AuthLayout';

export const RegisterResident = () => {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    contactNumber: '',
    address: '',
    deviceCode: '',
  });

  const [error, setError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [contactNumberError, setContactNumberError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const update = (field: keyof typeof formData) => (value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    update('contactNumber')(e.target.value.replace(/\D/g, '').slice(0, 11));
    if (contactNumberError) setContactNumberError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setConfirmPasswordError(null);
    setContactNumberError(null);

    if (formData.contactNumber && !PHONE_PATTERN.test(formData.contactNumber)) {
      setContactNumberError(PHONE_ERROR);
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setConfirmPasswordError('Passwords do not match.');
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
          address: formData.address.trim(),
          device_code: formData.deviceCode.trim(),
          requested_role: 'resident',
        }
      });

      if (registerError) throw new Error(await readFunctionError(registerError, 'Registration failed. Please try again.'));
      if (data?.error) throw new Error(data.error);

      navigate('/pending-approval', {
        state: { deviceCodeUnrecognized: data?.device_code_recognized === false }
      });
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
      title="Register as a resident"
      subtitle="Create an account to monitor the AgapSense device in your home and receive its alerts. An administrator reviews new accounts before you can sign in."
    >
      {error && <AuthAlert tone="error" className="mb-6">{error}</AuthAlert>}

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
            <Field label="Email address" icon={Mail} required>
              {({ id }) => (
                <input
                  id={id}
                  type="email"
                  required
                  autoComplete="email"
                  value={formData.email}
                  onChange={(e) => update('email')(e.target.value)}
                  className={inputClass()}
                  placeholder="you@example.com"
                />
              )}
            </Field>

            <Field
              label="Mobile number"
              icon={Phone}
              hint="For SMS fire alerts. 11 digits, starts with 09."
              error={contactNumberError}
            >
              {({ id, describedBy }) => (
                <input
                  id={id}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={formData.contactNumber}
                  onChange={handlePhoneChange}
                  maxLength={11}
                  aria-invalid={!!contactNumberError || undefined}
                  aria-describedby={describedBy}
                  className={inputClass(!!contactNumberError)}
                  placeholder="09XX XXX XXXX"
                />
              )}
            </Field>
          </div>
        </FormSection>

        <FormSection title="Home and device">
          <Field
            label="Home address"
            icon={MapPin}
            required
            iconTop
            hint="Responders use this to find your home during a fire alert."
          >
            {({ id, describedBy }) => (
              <textarea
                id={id}
                required
                autoComplete="street-address"
                value={formData.address}
                onChange={(e) => update('address')(e.target.value)}
                aria-describedby={describedBy}
                className={inputClass(false, 'h-auto py-3 resize-none')}
                placeholder="House no., street, barangay, city"
                rows={2}
              />
            )}
          </Field>

          <Field
            label="Device code"
            icon={Cpu}
            hint="The code that came with your AgapSense device. Don't have it yet? Leave this blank and an administrator will link your device during review."
          >
            {({ id, describedBy }) => (
              <input
                id={id}
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={formData.deviceCode}
                onChange={(e) => update('deviceCode')(e.target.value)}
                aria-describedby={describedBy}
                className={inputClass()}
                placeholder="e.g. AGS-001"
              />
            )}
          </Field>
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
