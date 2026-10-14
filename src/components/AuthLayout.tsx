import React, { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, ArrowLeft, BellRing, CheckCircle2, Eye, EyeOff, Info, Lock, Radio, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PROJECT_INFO } from '../lib/projectInfo';
import { Modal } from './ui';

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

const { title: projectTitle, school, program, section, team, area } = PROJECT_INFO;

const PROJECT_EYEBROW = ['Capstone project', section].filter(Boolean).join(' · ');
const DISCLAIMER = `Academic prototype for the ${area}. Not an official Bureau of Fire Protection service.`;

// Full credits, opened from the compact card (desktop) or footer link (phones).
const ProjectDialog = ({ onClose }: { onClose: () => void }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Modal title="About this project" onClose={onClose}>
      <div className="space-y-5 text-sm leading-relaxed text-[#534341]">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">{PROJECT_EYEBROW}</p>
          {projectTitle && <p className="mt-1.5 text-base font-bold leading-snug text-[#231918]">{projectTitle}</p>}
          {(program || school) && <p className="mt-2">{program}{program && school && <br />}{school}</p>}
        </div>
        {team.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#6B5856]">Proponents</p>
            <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[#231918]">
              {team.map((name) => <li key={name}>{name}</li>)}
            </ul>
          </div>
        )}
        <p className="pt-4 border-t border-border text-xs text-[#6B5856]">{DISCLAIMER}</p>
      </div>
    </Modal>
  );
};

const CapstoneCard = ({ onOpen }: { onOpen: () => void }) => (
  <div className="rounded-xl bg-black/20 ring-1 ring-white/15 p-5">
    <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/80">{PROJECT_EYEBROW}</p>
    <p className="mt-2 text-sm font-semibold leading-snug line-clamp-3">
      {projectTitle || `A student capstone project for homes in the ${area}.`}
    </p>
    <button
      type="button"
      onClick={onOpen}
      className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
    >
      <Info className="w-4 h-4" /> View project &amp; team
    </button>
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

export const AuthLayout = ({ title, subtitle, wide, backToLogin, children }: AuthLayoutProps) => {
  const [aboutOpen, setAboutOpen] = useState(false);
  const closeAbout = useCallback(() => setAboutOpen(false), []);

  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · AgapSense`;
    return () => { document.title = previous; };
  }, [title]);

  return (
    // Desktop: the page never scrolls; only the form column does, so a long
    // form's scrollbar can't narrow the brand panel compared to short pages.
    <div className="min-h-dvh bg-surface font-['Inter',_sans-serif] lg:grid lg:h-dvh lg:overflow-hidden lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Brand panel in the app's header red: a short band on phones/tablets, a full-height column on desktop. */}
      <aside className="relative overflow-hidden bg-gradient-to-br from-primary via-[#A51818] to-[#7F1212] text-white lg:h-dvh">
        <SignalRings />

        <div className="relative z-10 flex h-full flex-col lg:overflow-y-auto px-5 py-5 sm:px-8 sm:py-7 lg:px-12 lg:py-10 lg:mx-auto lg:w-full lg:max-w-[36rem]">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-white flex items-center justify-center shrink-0 shadow-sm">
              <Flame size={16} />
            </span>
            <span className="font-extrabold text-xl lg:text-2xl tracking-[-0.03em]">AgapSense</span>
          </div>

          <div className="lg:my-auto lg:py-8">
            <h1 className="mt-4 font-black tracking-[-0.03em] text-2xl leading-tight sm:text-3xl lg:mt-0 lg:text-[40px] lg:leading-[1.1] 2xl:text-5xl">
              Smarter detection,{' '}
              <br className="hidden lg:block" />
              <span className="text-[#FFC9B5]">faster response.</span>
            </h1>
            <p className="hidden lg:block mt-4 max-w-sm text-base text-white/90">
              IoT smoke and heat monitoring that alerts residents and BFP responders the moment a fire starts.
            </p>

            <ul className="hidden lg:[@media(min-height:860px)]:flex flex-col gap-5 mt-10">
              {FEATURES.map(({ icon: Icon, title: t, text }) => (
                <li key={t} className="flex gap-4">
                  <span className="w-10 h-10 shrink-0 rounded-lg bg-white/15 ring-1 ring-white/20 flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </span>
                  <div>
                    <p className="font-bold text-sm">{t}</p>
                    <p className="text-sm text-white/85 leading-relaxed">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="hidden lg:block">
            <CapstoneCard onOpen={() => setAboutOpen(true)} />
          </div>
        </div>
      </aside>

      {/* Stable gutter keeps the form in place whether or not it overflows;
          my-auto (not items-center) centres it without clipping a tall form. */}
      <main className="flex flex-col px-4 py-8 sm:px-8 sm:py-12 lg:h-dvh lg:overflow-y-auto lg:[scrollbar-gutter:stable]">
        <div className={`w-full mx-auto lg:my-auto ${wide ? 'max-w-xl' : 'max-w-md'}`}>
          {backToLogin && <BackToLogin className="mb-6" />}
          <div className="mb-8">
            <h2 className="text-2xl sm:text-[28px] font-extrabold tracking-[-0.025em] text-[#231918]">{title}</h2>
            {subtitle && <p className="mt-2 text-sm leading-relaxed text-[#534341]">{subtitle}</p>}
          </div>
          {children}

          <footer className="lg:hidden mt-12 pt-6 border-t border-border text-xs leading-relaxed text-[#6B5856]">
            <p className="font-bold uppercase tracking-[0.1em] text-[11px] text-[#534341]">{PROJECT_EYEBROW}</p>
            {projectTitle && <p className="mt-1.5 font-semibold text-[#534341]">{projectTitle}</p>}
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="mt-2 inline-flex items-center gap-1.5 py-1 font-semibold text-primary hover:underline"
            >
              <Info className="w-4 h-4" /> View project &amp; team
            </button>
          </footer>
        </div>
      </main>

      {aboutOpen && <ProjectDialog onClose={closeAbout} />}
    </div>
  );
};

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
            : <span className="ml-1.5 text-xs font-normal text-[#6B5856]">(optional)</span>}
        </label>
        {aside}
      </div>
      <div className="relative">
        <Icon className={`absolute left-3.5 w-5 h-5 text-[#6B5856] pointer-events-none ${iconTop ? 'top-3.5' : 'top-1/2 -translate-y-1/2'}`} />
        {children({ id, describedBy })}
      </div>
      {error
        ? <p id={hintId} className="mt-1.5 text-xs font-semibold text-tier2-border">{error}</p>
        : hint && <p id={hintId} className="mt-1.5 text-xs text-[#6B5856] leading-relaxed">{hint}</p>}
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
  inputRef?: React.Ref<HTMLInputElement>;
};

export const PasswordField = ({ label, value, onChange, autoComplete, minLength, placeholder, hint, error, aside, inputRef }: PasswordFieldProps) => {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const checkCapsLock = (e: React.KeyboardEvent | React.MouseEvent) => setCapsLock(e.getModifierState('CapsLock'));
  const capsHint = (
    <span role="status" className="inline-flex items-center gap-1.5 font-semibold text-tier1-text">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Caps Lock is on
    </span>
  );
  return (
    <Field label={label} icon={Lock} required hint={capsLock ? capsHint : hint} error={error} aside={aside}>
      {({ id, describedBy }) => (
        <>
          <input
            ref={inputRef}
            id={id}
            type={visible ? 'text' : 'password'}
            required
            minLength={minLength}
            autoComplete={autoComplete}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={checkCapsLock}
            onKeyUp={checkCapsLock}
            onMouseDown={checkCapsLock}
            onBlur={() => setCapsLock(false)}
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
            className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-md text-[#6B5856] hover:text-[#534341] transition-colors"
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

type AuthAlertProps = {
  tone: keyof typeof ALERT_TONES;
  children: React.ReactNode;
  className?: string;
  /** Lets a form scroll to and focus the alert (it is focusable via tabIndex -1). */
  ref?: React.Ref<HTMLDivElement>;
};

export const AuthAlert = ({ tone, children, className = '', ref }: AuthAlertProps) => {
  const { box, icon: Icon } = ALERT_TONES[tone];
  return (
    <div ref={ref} tabIndex={ref ? -1 : undefined} role={tone === 'error' ? 'alert' : 'status'} className={`p-4 border rounded-lg flex items-start gap-3 text-sm leading-relaxed scroll-mt-6 focus:outline-none ${box} ${className}`}>
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  );
};

/** Section heading inside the longer registration forms. */
export const FormSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <fieldset className="space-y-5">
    <legend className="text-xs font-bold uppercase tracking-[0.1em] text-[#6B5856] mb-4">{title}</legend>
    {children}
  </fieldset>
);

// Same minimum the register Edge Function enforces.
export const PASSWORD_MIN = 6;
