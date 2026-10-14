import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, ArrowLeft, BellRing, CheckCircle2, Eye, EyeOff, GraduationCap, Lock, Radio, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PROJECT_INFO } from '../lib/projectInfo';

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

const { label, year, school, program, team, area } = PROJECT_INFO;
const affiliation = [program, school].filter(Boolean).join(', ');

const CapstoneBadge = ({ className = '' }: { className?: string }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-primary shadow-sm whitespace-nowrap ${className}`}>
    <GraduationCap className="w-3.5 h-3.5" />
    {label} {year}
  </span>
);

const CapstoneCard = () => (
  <div className="rounded-xl bg-black/20 ring-1 ring-white/15 p-5">
    <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/60">About this project</p>
    <p className="mt-2 text-sm leading-relaxed text-white/85">
      AgapSense is a student capstone project: an IoT fire detection and alert system
      designed for homes in the {area}.
    </p>
    {affiliation && <p className="mt-2 text-sm font-semibold">{affiliation}</p>}
    {team.length > 0 && (
      <p className="mt-1 text-xs leading-relaxed text-white/70">{team.join(' \u00b7 ')}</p>
    )}
    <p className="mt-3 text-[11px] leading-relaxed text-white/55">
      Academic prototype. Not an official Bureau of Fire Protection service.
    </p>
  </div>
);

// Faint "sensor signal" rings radiating from a corner, in place of a photo.
const SignalRings = () => (
  <div aria-hidden="true" className="pointer-events-none absolute -right-24 -bottom-24 lg:-right-40 lg:-bottom-40">
    {[160, 280, 400, 520, 640].map((d, i) => (
      <span
        key={d}
        className="absolute rounded-full border border-white"
        style={{ width: d, height: d, right: -d / 2, bottom: -d / 2, opacity: 0.18 - i * 0.03 }}
      />
    ))}
  </div>
);

export const AuthLayout = ({ title, subtitle, wide, backToLogin, children }: AuthLayoutProps) => (
  <div className="min-h-dvh bg-surface font-['Inter',_sans-serif] lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
    {/* Brand panel in the app's header red: a short band on phones/tablets, a full-height column on desktop. */}
    <aside className="relative overflow-hidden bg-gradient-to-br from-primary via-[#A51818] to-[#7F1212] text-white lg:sticky lg:top-0 lg:h-dvh">
      <SignalRings />

      <div className="relative z-10 flex h-full flex-col px-5 py-5 sm:px-8 sm:py-7 lg:px-12 lg:py-10 xl:px-16">
        <div className="flex flex-wrap items-center justify-between lg:justify-start gap-x-4 gap-y-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-white flex items-center justify-center shrink-0 shadow-sm">
              <Flame size={16} />
            </span>
            <span className="font-extrabold text-xl lg:text-2xl tracking-[-0.03em]">AgapSense</span>
          </div>
          <CapstoneBadge />
        </div>

        <div className="lg:my-auto lg:py-8">
          <h1 className="mt-5 font-black tracking-[-0.03em] text-[26px] leading-tight sm:text-3xl lg:mt-0 lg:text-[40px] lg:leading-[1.1] 2xl:text-5xl">
            Smarter detection,{' '}
            <br className="hidden lg:block" />
            <span className="text-[#FFC9B5]">faster response.</span>
          </h1>
          <p className="mt-2 text-sm text-white/80 sm:text-base lg:mt-4 lg:max-w-sm">
            IoT smoke and heat monitoring that alerts residents and BFP responders the moment a fire starts.
          </p>

          <ul className="hidden lg:[@media(min-height:820px)]:flex flex-col gap-5 mt-10 max-w-sm">
            {FEATURES.map(({ icon: Icon, title: t, text }) => (
              <li key={t} className="flex gap-4">
                <span className="w-10 h-10 shrink-0 rounded-lg bg-white/15 ring-1 ring-white/20 flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </span>
                <div>
                  <p className="font-bold text-sm">{t}</p>
                  <p className="text-sm text-white/75 leading-relaxed">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="hidden lg:block max-w-sm">
          <CapstoneCard />
        </div>
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

        <footer className="lg:hidden mt-12 pt-6 border-t border-border text-xs leading-relaxed text-text-warm">
          <p className="font-semibold text-[#534341]">AgapSense · {label} {year}</p>
          {affiliation && <p>{affiliation}</p>}
          {team.length > 0 && <p>{team.join(' \u00b7 ')}</p>}
          <p className="mt-1">Academic prototype. Not an official Bureau of Fire Protection service.</p>
        </footer>
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
