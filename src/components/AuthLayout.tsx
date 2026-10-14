import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, ArrowLeft, BellRing, CheckCircle2, Eye, EyeOff, Lock, Radio, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Shared shell and form pieces for the signed-out pages (sign in, register,
// password reset, pending approval, session expired) so they share one
// layout, one input style and one set of buttons.

const Flame = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size * 1.25} viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 0C12 0 4 8 4 16C4 20.4183 7.58172 24 12 24C16.4183 24 20 20.4183 20 16C20 8 12 0 12 0Z" fill="#D32F2F"/>
    <path d="M12 12C12 12 8 16 8 20C8 22.2091 9.79086 24 12 24C14.2091 24 16 22.2091 16 20C16 16 12 12 12 12Z" fill="#FF8A65"/>
  </svg>
);

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Radio, title: 'Live monitoring', text: 'Smoke (CO) and temperature readings from every device, around the clock.' },
  { icon: BellRing, title: 'Instant alerts', text: 'Warnings by SMS, Telegram and app notification the moment levels rise.' },
  { icon: ShieldCheck, title: 'Faster response', text: 'Fire alerts go straight to BFP responders, with the home’s location.' },
];

type AuthLayoutProps = {
  title: string;
  subtitle?: React.ReactNode;
  /** Wider column for the longer registration forms. */
  wide?: boolean;
  /** Shows a "Back to sign in" link above the title. */
  backToLogin?: boolean;
  children: React.ReactNode;
};

export const AuthLayout = ({ title, subtitle, wide, backToLogin, children }: AuthLayoutProps) => (
  <div className="min-h-dvh bg-surface font-['Inter',_sans-serif] lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
    {/* Brand panel: a short band on phones/tablets, a full-height column on desktop. */}
    <aside className="relative overflow-hidden bg-[#4D2120] text-white lg:sticky lg:top-0 lg:h-dvh">
      <img src="/login_bg.png" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#4D2120]/40 via-[#4D2120]/60 to-[#2A1110]/90" />

      <div className="relative z-10 flex h-full flex-col px-5 py-6 sm:px-8 lg:px-12 lg:py-12">
        <div className="flex items-center gap-3">
          <Flame />
          <span className="font-black text-2xl tracking-[-0.05em] uppercase">AgapSense</span>
        </div>

        <h1 className="mt-4 font-black tracking-[-0.025em] text-2xl leading-tight sm:text-3xl lg:mt-10 lg:text-[44px] lg:leading-[1.15]">
          Smarter detection,{' '}
          <br className="hidden lg:block" />
          <span className="text-accent-light lg:text-accent">faster response.</span>
        </h1>

        <ul className="hidden lg:flex flex-col gap-6 mt-12 max-w-sm">
          {FEATURES.map(({ icon: Icon, title: t, text }) => (
            <li key={t} className="flex gap-4">
              <span className="w-10 h-10 shrink-0 rounded-lg bg-white/10 flex items-center justify-center">
                <Icon className="w-5 h-5 text-[#FF8A65]" />
              </span>
              <div>
                <p className="font-bold text-sm">{t}</p>
                <p className="text-sm text-white/70 leading-relaxed">{text}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="hidden lg:block mt-auto pt-12 text-xs text-white/50">
          IoT fire detection and alert system
        </p>
      </div>
    </aside>

    <main className="flex justify-center px-4 py-8 sm:px-8 sm:py-12 lg:items-center lg:min-h-dvh">
      <div className={`w-full ${wide ? 'max-w-xl' : 'max-w-md'}`}>
        {backToLogin && <BackToLogin className="mb-6" />}
        <div className="mb-8">
          <h2 className="text-2xl sm:text-[28px] font-extrabold tracking-[-0.025em] text-[#231918]">{title}</h2>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-[#534341]">{subtitle}</p>}
        </div>
        {children}
      </div>
    </main>
  </div>
);

export const BackToLogin = ({ className = '' }: { className?: string }) => (
  <Link
    to="/login"
    className={`inline-flex items-center gap-1.5 text-sm font-semibold text-[#534341] hover:text-primary transition-colors ${className}`}
  >
    <ArrowLeft className="w-4 h-4" /> Back to sign in
  </Link>
);

// ── Form pieces ────────────────────────────────────────────────────────────

const INPUT_BASE = 'w-full h-12 pl-11 pr-4 bg-white border rounded-lg text-base sm:text-sm text-[#231918] placeholder-[#A08F8D] focus:outline-none focus:ring-2 transition-colors disabled:opacity-60';
const INPUT_OK = 'border-border focus:border-primary focus:ring-primary/20';
const INPUT_ERR = 'border-tier2-border focus:border-tier2-border focus:ring-tier2-border/20';

export const inputClass = (hasError?: boolean, extra = '') => `${INPUT_BASE} ${hasError ? INPUT_ERR : INPUT_OK} ${extra}`;

export const AUTH_BTN_PRIMARY = 'w-full h-12 inline-flex items-center justify-center gap-2 px-4 rounded-lg bg-primary text-white font-bold text-sm hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_4px_12px_rgba(185,28,28,0.2)]';
export const AUTH_BTN_SECONDARY = 'w-full h-12 inline-flex items-center justify-center gap-2 px-4 rounded-lg border border-border bg-white text-[#231918] font-bold text-sm hover:bg-surface-alt hover:border-[#D8C2C0] transition-colors';

type FieldProps = {
  label: string;
  icon: LucideIcon;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string | null;
  /** Receives the generated input id and the ids describing it. */
  children: (ids: { id: string; describedBy?: string }) => React.ReactNode;
  /** Shown at the right end of the label row (e.g. "Forgot password?"). */
  aside?: React.ReactNode;
  iconTop?: boolean;
};

export const Field = ({ label, icon: Icon, required, hint, error, children, aside, iconTop }: FieldProps) => {
  const id = useId();
  const hintId = `${id}-hint`;
  const describedBy = error || hint ? hintId : undefined;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <label htmlFor={id} className="text-sm font-semibold text-[#231918]">
          {label}
          {required
            ? <span className="text-primary ml-0.5" aria-hidden="true">*</span>
            : <span className="ml-1.5 text-xs font-normal text-text-warm">(optional)</span>}
        </label>
        {aside}
      </div>
      <div className="relative">
        <Icon className={`absolute left-3.5 w-5 h-5 text-text-warm pointer-events-none ${iconTop ? 'top-3.5' : 'top-1/2 -translate-y-1/2'}`} />
        {children({ id, describedBy })}
      </div>
      {error
        ? <p id={hintId} className="mt-1.5 text-xs font-semibold text-tier2-border">{error}</p>
        : hint && <p id={hintId} className="mt-1.5 text-xs text-text-warm leading-relaxed">{hint}</p>}
    </div>
  );
};

type PasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  minLength?: number;
  placeholder?: string;
  hint?: React.ReactNode;
  error?: string | null;
  aside?: React.ReactNode;
};

export const PasswordField = ({ label, value, onChange, autoComplete, minLength, placeholder, hint, error, aside }: PasswordFieldProps) => {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} icon={Lock} required hint={hint} error={error} aside={aside}>
      {({ id, describedBy }) => (
        <>
          <input
            id={id}
            type={visible ? 'text' : 'password'}
            required
            minLength={minLength}
            autoComplete={autoComplete}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!!error || undefined}
            aria-describedby={describedBy}
            className={inputClass(!!error, 'pr-12')}
            placeholder={placeholder}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-md text-text-warm hover:text-[#534341] transition-colors"
          >
            {visible ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </>
      )}
    </Field>
  );
};

const ALERT_TONES = {
  error: { box: 'bg-tier2-bg border-tier2-border/40 text-tier2-text', icon: AlertCircle },
  success: { box: 'bg-[#F0FDF4] border-[#86EFAC] text-[#166534]', icon: CheckCircle2 },
  warning: { box: 'bg-tier1-bg border-tier1-border/40 text-tier1-text', icon: AlertTriangle },
} as const;

export const AuthAlert = ({ tone, children, className = '' }: { tone: keyof typeof ALERT_TONES; children: React.ReactNode; className?: string }) => {
  const { box, icon: Icon } = ALERT_TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`p-4 border rounded-lg flex items-start gap-3 text-sm leading-relaxed ${box} ${className}`}>
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  );
};

/** Section heading inside the longer registration forms. */
export const FormSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <fieldset className="space-y-5">
    <legend className="text-xs font-bold uppercase tracking-[0.1em] text-text-warm mb-4">{title}</legend>
    {children}
  </fieldset>
);

// Same rule the register Edge Function enforces.
export const PHONE_PATTERN = /^09\d{9}$/;
export const PHONE_ERROR = 'Enter an 11-digit mobile number that starts with 09.';
export const PASSWORD_MIN = 6;
