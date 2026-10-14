import { useState, useEffect } from 'react';
import type { ComponentType, InputHTMLAttributes } from 'react';
import { supabase } from '../../lib/supabase';
import { startTelegramLink } from '../../lib/telegramLink';
import { useAuth } from '../../contexts/AuthContext';
import { ProfileSkeleton } from '../../components/SkeletonLoaders';
import { Save, User, Phone, Shield, Calendar, Building2, MapPin, Mail, Send, Bell } from 'lucide-react';
import { AdminSupportModal } from '../../components/AdminSupportModal';
import { MySupportRequests } from '../../components/MySupportRequests';
import { PageHeader } from '../../components/PageHeader';
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL, PILL_OK, PILL_WARN, PILL_OFF } from '../../components/ui';
import { getRoleLabel } from '../../lib/supportRequests';
import { PHONE_PATTERN, PHONE_ERROR, normalizePhone, isStationPhone, STATION_PHONE_ERROR } from '../../lib/phone';
import { subscribeUserToPush, unsubscribeUserFromPush, getPushSubscription, describePushError, isBraveBrowser } from '../../lib/pushNotifications';

type Msg = { ok: boolean; text: string } | null;

const CARD = 'bg-white border border-border rounded-lg p-5 sm:p-6 min-w-0';
const CARD_TITLE = 'text-lg font-bold tracking-[-0.01em] text-text';

// Flash a message for a few seconds (success) or until replaced (errors stay so they can be read).
const useMsg = () => {
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    if (!msg?.ok) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg, setMsg] as const;
};

const MsgLine = ({ msg }: { msg: Msg }) => msg && (
  <p role={msg.ok ? 'status' : 'alert'} className={`text-xs font-semibold ${msg.ok ? 'text-success-dark' : 'text-primary'}`}>{msg.text}</p>
);

const IconField = ({ id, label, icon: Icon, hint, error, ...input }: {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  hint?: string;
  error?: string;
} & InputHTMLAttributes<HTMLInputElement>) => (
  <div>
    <label htmlFor={id} className={LABEL}>{label}</label>
    <div className="relative">
      <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={hint || error ? `${id}-help` : undefined}
        className={`${FIELD} pl-10 ${error ? '!border-primary' : ''}`}
        {...input}
      />
    </div>
    {(error || hint) && (
      <p id={`${id}-help`} className={`text-xs mt-2 ${error ? 'text-primary font-semibold' : 'text-text-subtle'}`}>{error || hint}</p>
    )}
  </div>
);

export const ResponderSettings = () => {
  const { profile, user } = useAuth();

  // ─── Personal details ───
  const [fullName, setFullName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [orig, setOrig] = useState({ name: '', contact: '' });
  const [contactError, setContactError] = useState('');
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useMsg();

  // ─── Notifications ───
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(true);
  const [notifyMsg, setNotifyMsg] = useMsg();

  // ─── Station ───
  const [station, setStation] = useState({ name: '', address: '', contact: '', email: '' });
  const [stationOrig, setStationOrig] = useState(station);
  const [stationLoading, setStationLoading] = useState(true);
  const [stationSaving, setStationSaving] = useState(false);
  const [stationContactError, setStationContactError] = useState('');
  const [stationMsg, setStationMsg] = useMsg();

  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [supportRefresh, setSupportRefresh] = useState(0);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name || '');
    setContactNumber(profile.contact_number || '');
    setOrig({ name: profile.full_name || '', contact: profile.contact_number || '' });
  }, [profile]);

  useEffect(() => {
    getPushSubscription().then(sub => { setPushOn(!!sub); setPushBusy(false); });
    (async () => {
      const { data, error } = await supabase.from('station_settings').select('*').eq('id', 1).maybeSingle();
      if (error) setStationMsg({ ok: false, text: "Couldn't load station information." });
      if (data) {
        const s = { name: data.station_name ?? '', address: data.address ?? '', contact: data.contact_number ?? '', email: data.email ?? '' };
        setStation(s);
        setStationOrig(s);
      }
      setStationLoading(false);
    })();
  }, [setStationMsg]);

  const profileChanged = fullName.trim() !== orig.name || contactNumber !== orig.contact;
  const stationChanged = (Object.keys(station) as (keyof typeof station)[]).some(k => station[k].trim() !== stationOrig[k]);

  const handleSaveProfile = async () => {
    if (!profile) return;
    if (!fullName.trim()) { setProfileMsg({ ok: false, text: 'Enter your full name.' }); return; }
    if (contactNumber && !PHONE_PATTERN.test(contactNumber)) { setContactError(PHONE_ERROR); return; }
    setContactError('');
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), contact_number: contactNumber || null })
      .eq('id', profile.id);
    setSaving(false);
    if (error) { setProfileMsg({ ok: false, text: `Couldn't save: ${error.message}` }); return; }
    setOrig({ name: fullName.trim(), contact: contactNumber });
    setFullName(fullName.trim());
    setProfileMsg({ ok: true, text: 'Saved.' });
  };

  const handleSaveStation = async () => {
    if (station.contact.trim() && !isStationPhone(station.contact)) { setStationContactError(STATION_PHONE_ERROR); return; }
    if (station.email.trim() && !/^\S+@\S+\.\S+$/.test(station.email.trim())) { setStationMsg({ ok: false, text: 'Enter a valid email address.' }); return; }
    setStationContactError('');
    setStationSaving(true);
    const next = { name: station.name.trim(), address: station.address.trim(), contact: station.contact.trim(), email: station.email.trim() };
    const { error } = await supabase
      .from('station_settings')
      .update({ station_name: next.name, address: next.address, contact_number: next.contact, email: next.email })
      .eq('id', 1);
    setStationSaving(false);
    if (error) { setStationMsg({ ok: false, text: `Couldn't save: ${error.message}` }); return; }
    setStation(next);
    setStationOrig(next);
    setStationMsg({ ok: true, text: 'Saved.' });
  };

  const handleTogglePush = async () => {
    setPushBusy(true);
    setNotifyMsg(null);
    try {
      if (pushOn) {
        await unsubscribeUserFromPush();
        setPushOn(false);
      } else if ((await Notification.requestPermission()) === 'granted') {
        await subscribeUserToPush();
        setPushOn(true);
      } else {
        setNotifyMsg({ ok: false, text: 'Notifications are blocked for this site. Allow them in your browser settings, then try again.' });
      }
    } catch (e) {
      console.error(e);
      setNotifyMsg({ ok: false, text: describePushError(e, await isBraveBrowser()) });
    } finally {
      setPushBusy(false);
    }
  };

  const handleConnectTelegram = async () => {
    setNotifyMsg(null);
    const message = await startTelegramLink();
    if (message) setNotifyMsg({ ok: false, text: message });
  };

  if (!profile) return <ProfileSkeleton />;
  const telegramLinked = !!profile.telegram_chat_id;

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader title="Settings" description="Your details, how you get fire alerts, and your station's information." />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 flex flex-col gap-6 min-w-0">
          {/* ─── Personal details ─── */}
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Personal Details</h2>
            <div className="flex flex-col gap-6 mt-6">
              <IconField id="full-name" label="Full name" icon={User} value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" />
              <IconField
                id="contact-number"
                label="Mobile number"
                icon={Phone}
                type="tel"
                inputMode="numeric"
                placeholder="09XXXXXXXXX"
                value={contactNumber}
                onChange={e => { setContactNumber(normalizePhone(e.target.value)); setContactError(''); }}
                hint="So an administrator can reach you. Optional."
                error={contactError}
              />
              <div>
                <span className={LABEL}>Email</span>
                <div className="flex items-center gap-2 h-10 px-3 border border-border rounded-lg bg-surface-alt text-sm text-text">
                  <Mail className="w-4 h-4 text-text-faint shrink-0" />
                  <span className="truncate">{user?.email || 'Not available'}</span>
                </div>
                <p className="text-xs text-text-subtle mt-2">Used to sign in. Ask an administrator to change it.</p>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-t border-border-warm pt-5">
                <button type="button" onClick={handleSaveProfile} disabled={saving || !profileChanged} className={BTN_PRIMARY}>
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <MsgLine msg={profileMsg} />
              </div>
            </div>
          </section>

          {/* ─── How alerts reach you ─── */}
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Fire Alert Notifications</h2>
            <p className="text-sm text-text-subtle mt-1">
              You are alerted for fires (Tier 2) only. Single-sensor warnings (Tier 1) go to administrators, who check the site first.
            </p>

            <ul className="mt-5 flex flex-col divide-y divide-border-warm border border-border rounded-lg">
              <li className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-surface-alt hidden sm:flex items-center justify-center shrink-0" aria-hidden="true">
                  <Send className="w-4 h-4 text-text-body" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-text">Telegram</h3>
                    <span className={telegramLinked ? PILL_OK : PILL_WARN}>{telegramLinked ? 'Linked' : 'Not linked'}</span>
                  </div>
                  <p className="text-xs text-text-subtle mt-1 leading-relaxed">
                    A message with the device, address, readings and a map link, sent to your own Telegram account.
                  </p>
                </div>
                <button type="button" onClick={handleConnectTelegram} className={`${telegramLinked ? BTN_SECONDARY : BTN_PRIMARY} w-full sm:w-auto sm:shrink-0`}>
                  <Send className="w-4 h-4" />
                  {telegramLinked ? 'Relink' : 'Link Telegram'}
                </button>
              </li>
              <li className="p-4 flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-surface-alt hidden sm:flex items-center justify-center shrink-0" aria-hidden="true">
                  <Bell className="w-4 h-4 text-text-body" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 id="push-label" className="text-sm font-bold text-text">Browser notifications</h3>
                    <span className={pushOn ? PILL_OK : PILL_OFF}>{pushOn ? 'On' : 'Off'}</span>
                  </div>
                  <p className="text-xs text-text-subtle mt-1 leading-relaxed">
                    A pop-up with sound on this device, even when AgapSense is not open. Turn it on for each phone or computer you use.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={pushOn}
                  aria-labelledby="push-label"
                  onClick={handleTogglePush}
                  disabled={pushBusy}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${pushOn ? 'bg-primary' : 'bg-border'}`}
                >
                  <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${pushOn ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </li>
            </ul>
            {notifyMsg && <div className="mt-3"><MsgLine msg={notifyMsg} /></div>}
          </section>

          {/* ─── Station ─── */}
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Station Information</h2>
            <p className="text-sm text-text-subtle mt-1">Your fire station's public details. Shared by every responder account.</p>

            {stationLoading ? (
              <div className="flex flex-col gap-4 mt-6">
                {[0, 1, 2].map(i => <div key={i} className="h-10 rounded-lg skeleton-pulse" />)}
              </div>
            ) : (
              <div className="flex flex-col gap-6 mt-6">
                <IconField id="station-name" label="Station name" icon={Building2} value={station.name} onChange={e => setStation(s => ({ ...s, name: e.target.value }))} placeholder="e.g. BFP Malolos City Fire Station" />
                <IconField id="station-address" label="Address" icon={MapPin} value={station.address} onChange={e => setStation(s => ({ ...s, address: e.target.value }))} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <IconField
                    id="station-contact"
                    label="Hotline"
                    icon={Phone}
                    type="tel"
                    value={station.contact}
                    onChange={e => { setStation(s => ({ ...s, contact: e.target.value })); setStationContactError(''); }}
                    placeholder="e.g. 044 791 1234"
                    hint="Mobile or landline with area code."
                    error={stationContactError}
                  />
                  <IconField id="station-email" label="Email" icon={Mail} type="email" value={station.email} onChange={e => setStation(s => ({ ...s, email: e.target.value }))} />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-t border-border-warm pt-5">
                  <button type="button" onClick={handleSaveStation} disabled={stationSaving || !stationChanged} className={BTN_PRIMARY}>
                    <Save className="w-4 h-4" />
                    {stationSaving ? 'Saving…' : 'Save station information'}
                  </button>
                  <MsgLine msg={stationMsg} />
                </div>
              </div>
            )}
          </section>
        </div>

        {/* ─── Sidebar ─── */}
        <div className="lg:col-span-1 flex flex-col gap-6 min-w-0">
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Account</h2>
            <dl className="flex flex-col gap-4 mt-5">
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-text-body shrink-0" />
                <div className="min-w-0">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-body">Role</dt>
                  <dd className="text-sm font-bold text-text">{getRoleLabel(profile.role)}</dd>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-text-body shrink-0" />
                <div className="min-w-0">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-body">Member since</dt>
                  <dd className="text-sm font-bold text-text">{new Date(profile.created_at).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}</dd>
                </div>
              </div>
            </dl>
          </section>

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Need Help?</h2>
            <p className="text-xs text-text-subtle leading-relaxed mt-1">
              Ask an administrator to change your role, reset your password, or fix account access.
            </p>
            <button type="button" onClick={() => setIsSupportModalOpen(true)} className={`${BTN_PRIMARY} w-full mt-4`}>
              <Mail className="w-4 h-4" />
              Contact administrator
            </button>
          </section>

          <MySupportRequests
            userId={profile.id}
            refreshKey={supportRefresh}
            cardClassName={CARD}
            titleClassName={CARD_TITLE}
          />
        </div>
      </div>

      <AdminSupportModal
        isOpen={isSupportModalOpen}
        onClose={() => setIsSupportModalOpen(false)}
        profile={profile}
        userEmail={user?.email}
        onSubmitted={() => setSupportRefresh(n => n + 1)}
      />
    </div>
  );
};
