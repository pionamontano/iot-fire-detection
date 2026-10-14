import React, { useEffect, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { supabase } from '../../lib/supabase';
import { Save, Clock, ShieldCheck, Activity, Unlock, Bell, BellOff, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { SettingsFormSkeleton } from '../../components/SkeletonLoaders';
import { subscribeUserToPush, unsubscribeUserFromPush, getPushSubscription, describePushError, isBraveBrowser } from '../../lib/pushNotifications';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import { ONLINE_THRESHOLD_MS, RECONNECTING_THRESHOLD_MS } from '../../lib/deviceStatus';
import { FIELD, BTN_PRIMARY, BTN_SECONDARY } from '../../components/ui';

const LABEL = 'block text-xs font-bold text-text-body mb-2 uppercase tracking-[0.1em]';
const SECTION_TITLE = 'text-xs font-bold text-text-body uppercase tracking-[0.1em] mb-1 flex items-center gap-2';

// Same fallbacks useIdleTimeout effectively shows when a key is missing.
const TIMEOUTS = [
  { key: 'timeout_admin', label: 'Admin Timeout', summary: 'Admin Session Timeout', fallback: '15' },
  { key: 'timeout_bfp', label: 'Responder Timeout', summary: 'Responder Session Timeout', fallback: '15' },
  { key: 'timeout_resident', label: 'Resident Timeout', summary: 'Resident Session Timeout', fallback: '60' },
];
const MIN_TIMEOUT = 1;
const MAX_TIMEOUT = 1440;

const timeoutError = (value: string) => {
  if (!/^\d+$/.test(value.trim())) return 'Enter a whole number of minutes.';
  const n = Number(value);
  if (n < MIN_TIMEOUT || n > MAX_TIMEOUT) return `Must be between ${MIN_TIMEOUT} and ${MAX_TIMEOUT} minutes.`;
  return null;
};

const withFallbacks = (map: Record<string, string>) => {
  const out = { ...map };
  TIMEOUTS.forEach(t => { if (!out[t.key]) out[t.key] = t.fallback; });
  return out;
};

export const Settings = () => {
  const [settings, setSettings] = useState<Record<string, string>>(withFallbacks({}));
  // Last values read from / written to the database, for the summary and the dirty check.
  const [savedSettings, setSavedSettings] = useState<Record<string, string>>(withFallbacks({}));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null);

  // Manual unlock for a login-rate-limit lockout (spec SW-2.6.2's
  // "requiring Administrator intervention") — the lockout itself is
  // otherwise purely time-window based and only expires on its own.
  const [unlockEmail, setUnlockEmail] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockMessage, setUnlockMessage] = useState<string | null>(null);

  const [isPushSubscribed, setIsPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(true);
  const [pushError, setPushError] = useState('');

  useEffect(() => {
    fetchSettings();
    getPushSubscription().then(sub => {
      setIsPushSubscribed(!!sub);
      setPushLoading(false);
    });
  }, []);

  const handleTogglePush = async () => {
    setPushLoading(true);
    setPushError('');
    try {
      if (isPushSubscribed) {
        await unsubscribeUserFromPush();
        setIsPushSubscribed(false);
      } else {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          await subscribeUserToPush();
          setIsPushSubscribed(true);
        } else {
          setPushError('Notification permission denied by browser.');
          setTimeout(() => setPushError(''), 5000);
        }
      }
    } catch (e: any) {
      console.error(e);
      setPushError(describePushError(e, await isBraveBrowser()));
      setTimeout(() => setPushError(''), 5000);
    } finally {
      setPushLoading(false);
    }
  };

  const fetchSettings = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('settings').select('*');
    // A failed read must be visible, not look like an empty settings table
    // whose fields just happen to fall back to their hardcoded defaults.
    setLoadError(error ? { message: error.message, code: error.code } : null);
    if (!error && data) {
      const settingsMap: Record<string, string> = {};
      data.forEach(s => {
        settingsMap[s.key] = s.value;
      });
      setSettings(withFallbacks(settingsMap));
      setSavedSettings(withFallbacks(settingsMap));
    }
    setLoading(false);
  };

  const handleChange = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaveMessage(null);
  };

  const errors = Object.fromEntries(TIMEOUTS.map(t => [t.key, timeoutError(settings[t.key] ?? '')]));
  const hasErrors = Object.values(errors).some(Boolean);
  const isDirty = TIMEOUTS.some(t => (settings[t.key] ?? '').trim() !== savedSettings[t.key]);

  const handleUnlock = async () => {
    // The login function records attempts under the lowercased email, so the
    // override has to use the same key or it never matches.
    const email = unlockEmail.trim().toLowerCase();
    if (!email) return;
    setUnlocking(true);
    setUnlockMessage(null);
    const { error } = await supabase.rpc('admin_unlock_login', { p_email: email });
    if (error) {
      setUnlockMessage('Failed: ' + error.message);
    } else {
      setUnlockMessage(`${email} can now sign in again immediately.`);
      setUnlockEmail('');
    }
    setUnlocking(false);
  };

  const handleSave = async () => {
    if (loadError) {
      setSaveMessage({ ok: false, text: "Can't save: the current settings failed to load, so saving now would overwrite them with fallback defaults. Retry loading first." });
      return;
    }
    if (hasErrors) return;
    setSaving(true);
    setSaveMessage(null);
    const updates = TIMEOUTS.map(t => ({ key: t.key, value: String(Number(settings[t.key])) }));

    const { error } = await supabase.from('settings').upsert(updates);

    if (error) {
      setSaveMessage({ ok: false, text: 'Failed to save settings: ' + error.message });
    } else {
      const saved = { ...settings, ...Object.fromEntries(updates.map(u => [u.key, u.value])) };
      setSettings(saved);
      setSavedSettings(saved);
      setSaveMessage({ ok: true, text: 'Settings saved. New timeouts apply to signed-in users within 5 minutes.' });
    }
    setSaving(false);
  };

  return (
    <div className="max-w-4xl space-y-8">
      {loadError && (
        <LoadErrorBanner what="settings" error={loadError} onRetry={fetchSettings} />
      )}
      {/* Page Header */}
      <PageHeader
        title="Settings"
        eyebrow="System Security Configuration"
        description="Global application parameters and security policies."
      />

      {/* Settings Card */}
      <div className="bg-surface-card border border-border rounded-lg overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        {/* Section Header */}
        <div className="px-5 sm:px-8 py-5 border-b border-border bg-surface-alt flex items-center gap-3">
          <ShieldCheck className="text-primary w-5 h-5" />
          <h3 className="text-base font-bold text-text-heading">Security & Session Policies</h3>
        </div>

        {loading ? (
          <SettingsFormSkeleton />
        ) : (
          <div className="p-5 sm:p-8 space-y-8">

            {/* Session Timeouts */}
            <div>
              <h4 className={SECTION_TITLE}>
                <Clock className="w-3.5 h-3.5" />
                Inactivity Timeouts (Minutes)
              </h4>
              <p className="text-xs text-text-warm mb-5">Set how long users can be inactive before they are automatically logged out for security purposes.</p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {TIMEOUTS.map(t => (
                  <div key={t.key}>
                    <label htmlFor={t.key} className={LABEL}>{t.label}</label>
                    <input
                      id={t.key}
                      type="number" min={MIN_TIMEOUT} max={MAX_TIMEOUT} step="1" inputMode="numeric"
                      value={settings[t.key] ?? ''}
                      onChange={(e) => handleChange(t.key, e.target.value)}
                      aria-invalid={!!errors[t.key]}
                      className={`${FIELD} ${errors[t.key] ? '!border-tier2-border !ring-tier2-border' : ''}`}
                    />
                    {errors[t.key] && <p className="text-xs font-semibold text-tier2-border mt-2">{errors[t.key]}</p>}
                  </div>
                ))}
              </div>
            </div>

            {/* Node Monitoring */}
            <div className="pt-8 border-t border-border">
              <h4 className={SECTION_TITLE}>
                <Activity className="w-3.5 h-3.5" />
                Node Monitoring
              </h4>
              <p className="text-xs text-text-warm mb-5">
                How long since a node's last reading before its status changes. These thresholds are fixed in the app and can't be edited here.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className={LABEL}>Reconnecting After (Minutes)</label>
                  <input type="number" disabled value={ONLINE_THRESHOLD_MS / 60000} className={`${FIELD} !bg-surface-alt text-text-faint cursor-not-allowed`} />
                </div>
                <div>
                  <label className={LABEL}>Offline After (Minutes)</label>
                  <input type="number" disabled value={RECONNECTING_THRESHOLD_MS / 60000} className={`${FIELD} !bg-surface-alt text-text-faint cursor-not-allowed`} />
                </div>
              </div>
            </div>

            {/* Account Lockouts */}
            <div className="pt-8 border-t border-border">
              <h4 className={SECTION_TITLE}>
                <Unlock className="w-3.5 h-3.5" />
                Account Lockouts
              </h4>
              <p className="text-xs text-text-warm mb-5">
                A locked-out account (7+ failed logins) normally clears itself after 15 minutes.
                Enter the account's email to lift the lockout immediately.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <input
                  type="email"
                  placeholder="user@example.com"
                  aria-label="Email of the locked-out account"
                  value={unlockEmail}
                  onChange={(e) => { setUnlockEmail(e.target.value); setUnlockMessage(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                  className={`${FIELD} flex-1`}
                />
                <button
                  onClick={handleUnlock}
                  disabled={unlocking || !unlockEmail.trim()}
                  className={`${BTN_SECONDARY} shrink-0`}
                >
                  {unlocking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
                  {unlocking ? 'Unlocking...' : 'Unlock Account'}
                </button>
              </div>
              {unlockMessage && (
                <p className={`text-xs font-semibold mt-3 ${unlockMessage.startsWith('Failed') ? 'text-tier2-border' : 'text-success-dark'}`}>{unlockMessage}</p>
              )}
            </div>

            {/* Push Notifications */}
            <div className="pt-8 border-t border-border">
              <h4 className={SECTION_TITLE}>
                <Bell className="w-3.5 h-3.5" />
                Browser Push Notifications
              </h4>
              <p className="text-xs text-text-warm mb-5">
                Receive fire alert and support-request notifications directly in this browser, even when the dashboard isn't open.
                This applies to this browser only and is saved immediately.
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-alt border border-border rounded-lg px-4 py-3.5">
                {isPushSubscribed ? (
                  <span className="w-fit inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold bg-success/10 text-success-dark border-success/30">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Enabled
                  </span>
                ) : (
                  <span className="w-fit inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold bg-tier1-bg text-tier1-text border-amber-light/40">
                    <BellOff className="w-3.5 h-3.5" />
                    Disabled
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleTogglePush}
                  disabled={pushLoading}
                  className={`${BTN_SECONDARY} shrink-0`}
                >
                  {pushLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : isPushSubscribed ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                  {pushLoading ? 'Processing...' : (isPushSubscribed ? 'Disable Push Notifications' : 'Enable Push Notifications')}
                </button>
              </div>
              {pushError && (
                <div className="flex items-center gap-2 mt-3 text-xs font-bold text-tier2-border">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {pushError}
                </div>
              )}
            </div>

          </div>
        )}

        {/* Save bar */}
        <div className="px-5 sm:px-8 py-4 bg-surface-alt border-t border-border flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
          <p className={`text-xs font-semibold ${saveMessage ? (saveMessage.ok ? 'text-success-dark' : 'text-tier2-border') : isDirty ? 'text-amber' : 'text-text-faint'}`} role="status">
            {saveMessage?.text ?? (loading ? '' : isDirty ? 'You have unsaved changes.' : 'All changes saved.')}
          </p>
          <div className="flex flex-col-reverse sm:flex-row gap-3">
            {isDirty && (
              <button
                type="button"
                onClick={() => { setSettings(savedSettings); setSaveMessage(null); }}
                disabled={saving}
                className={BTN_SECONDARY}
              >
                Discard
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || loading || !isDirty || hasErrors}
              className={BTN_PRIMARY}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>

      {/* Current Configuration Summary: what's actually in effect, not unsaved edits */}
      <div className="bg-surface-alt border-l-4 border-primary-dark rounded-lg p-5 sm:p-8 space-y-6">
        <h4 className="text-primary-dark font-bold text-xs uppercase tracking-[0.1em]">Current Configuration Summary</h4>
        <div className="space-y-3">
          {[
            ...TIMEOUTS.map(t => ({ label: t.summary, value: `${savedSettings[t.key]} min` })),
            { label: 'Node Reconnecting / Offline After', value: `${ONLINE_THRESHOLD_MS / 60000} / ${RECONNECTING_THRESHOLD_MS / 60000} min` },
            { label: 'Push Notifications (this browser)', value: pushLoading ? '…' : isPushSubscribed ? 'On' : 'Off' },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between gap-4 bg-surface-card rounded-lg px-4 py-3 border border-border">
              <span className="text-sm font-semibold text-text-heading">{item.label}</span>
              <span className="text-sm font-bold font-mono text-text-heading whitespace-nowrap">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
