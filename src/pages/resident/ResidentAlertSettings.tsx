import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { Device } from '../../lib/supabase';
import { Thermometer, Wind, HelpCircle, AlertTriangle, Save, Send, X, Phone, Bell, BellOff, ArrowRight } from 'lucide-react';
import { AlertSettingsSkeleton } from '../../components/SkeletonLoaders';
import { TABLE_CARD, TABLE, THEAD_ROW, TH, TR, TD, TableScroll } from '../../components/Table';
import { subscribeUserToPush, unsubscribeUserFromPush, getPushState, describePushError, isBraveBrowser } from '../../lib/pushNotifications';
import type { PushState } from '../../lib/pushNotifications';
import { startTelegramLink } from '../../lib/telegramLink';
import { PageHeader } from '../../components/PageHeader';
import { BTN_PRIMARY, BTN_SECONDARY, PILL_OK, PILL_WARN, PILL_OFF } from '../../components/ui';
import { PHONE_PATTERN, PHONE_ERROR, normalizePhone } from '../../lib/phone';
import { NoDeviceLinked } from '../../components/NoDeviceLinked';

// Two independent parts: the alert levels (saved together with one Save) and
// where alerts are sent (SMS number, push and Telegram, each applied on its own).
// Residents receive fire alerts (Tier 2); warnings (Tier 1) only show in the app.

const CARD = 'bg-white border border-border rounded-lg p-5 sm:p-6';
const CARD_TITLE = 'text-lg font-bold tracking-[-0.01em] text-text';

// One alert level: label, value, slider, scale and any warning, with a real <label>.
const LevelSlider = ({ id, icon: Icon, label, value, original, unit, min, max, step, onChange, warning, children }: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  original: number;
  unit: string;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  warning: string | null;
  children?: React.ReactNode;
}) => (
  <div className="flex flex-col gap-3">
    <div className="flex justify-between items-end gap-3">
      <label htmlFor={id} className="inline-flex items-center gap-2 text-sm font-bold text-text">
        <Icon className="w-4 h-4 text-text-body" /> {label}
      </label>
      <span className={`text-[28px] leading-8 font-extrabold tracking-[-0.03em] tabular-nums ${value !== original ? 'text-[#B45309]' : 'text-text'}`}>
        {value} <span className="text-sm font-bold text-text-body">{unit}</span>
      </span>
    </div>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-2 bg-surface-cream rounded-lg appearance-none cursor-pointer accent-primary"
    />
    <div className="flex justify-between text-[11px] font-semibold text-text-faint tabular-nums">
      <span>{min} {unit}</span>
      {value !== original && <span className="text-[#B45309]">Saved: {original} {unit}</span>}
      <span>{max} {unit}</span>
    </div>
    {warning && (
      <p className="flex items-center gap-2 text-xs font-semibold text-[#B45309]">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {warning}
      </p>
    )}
    {children}
  </div>
);

// A row in "Where alerts are sent": what it is, whether it's on, and its control.
const ChannelRow = ({ icon: Icon, title, detail, status, tone, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  status: string;
  tone: 'ok' | 'warn' | 'none';
  children?: React.ReactNode;
}) => (
  <li className="py-5 first:pt-0 last:pb-0 flex flex-col gap-3">
    <div className="flex items-start justify-between gap-3">
      <div className="flex gap-3 min-w-0">
        <Icon className="w-4 h-4 mt-0.5 text-text-body shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-text">{title}</p>
          <p className="text-xs text-text-subtle mt-0.5">{detail}</p>
        </div>
      </div>
      <span className={`${tone === 'ok' ? PILL_OK : tone === 'warn' ? PILL_WARN : PILL_OFF} shrink-0`}>{status}</span>
    </div>
    {children && <div className="pl-7">{children}</div>}
  </li>
);

export const ResidentAlertSettings = () => {
  const { profile } = useAuth();
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);

  // Alert levels
  const [tempThreshold, setTempThreshold] = useState(55);
  const [coThreshold, setCoThreshold] = useState(300);
  const [origTemp, setOrigTemp] = useState(55);
  const [origCo, setOrigCo] = useState(300);
  const [savingLevels, setSavingLevels] = useState(false);
  const [levelsMsg, setLevelsMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // SMS number (profiles.contact_number: the number trigger-alert returns as owner_contact)
  const [contactNumber, setContactNumber] = useState('');
  const [origContact, setOrigContact] = useState('');
  const [savingContact, setSavingContact] = useState(false);
  const [contactMsg, setContactMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Push and Telegram
  const [pushState, setPushState] = useState<PushState | 'checking'>('checking');
  const [pushBusy, setPushBusy] = useState(false);
  const [channelError, setChannelError] = useState('');

  const [isAdviceModalOpen, setIsAdviceModalOpen] = useState(false);

  // Keyed on the device id, not the whole profile: the profile refreshes in the
  // background (AuthContext), and reloading here would wipe unsaved slider changes.
  const deviceId = profile?.device_id;
  const profileLoaded = !!profile;
  useEffect(() => {
    if (deviceId) {
      fetchDevice(deviceId);
      getPushState().then(setPushState);
    } else if (profileLoaded) {
      setLoading(false);
    }
  }, [deviceId, profileLoaded]);

  // The SMS number is profiles.contact_number (the number trigger-alert returns as
  // owner_contact) - not devices.bfp_contact, the fire station's number for the
  // technical BFP SMS. This page once wrote bfp_contact by mistake.
  const savedNumber = profile?.contact_number || '';
  useEffect(() => {
    setContactNumber(savedNumber);
    setOrigContact(savedNumber);
  }, [savedNumber]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsAdviceModalOpen(false);
    };
    if (isAdviceModalOpen) {
      window.addEventListener('keydown', handleEsc);
    }
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isAdviceModalOpen]);

  const fetchDevice = async (deviceId: string) => {
    try {
      const { data, error } = await supabase.from('devices_safe').select('*').eq('id', deviceId).single();
      if (data) {
        setDevice(data);
        setTempThreshold(data.temp_threshold || 55);
        setCoThreshold(data.co_threshold || 300);
        setOrigTemp(data.temp_threshold || 55);
        setOrigCo(data.co_threshold || 300);
      }
      if (error) console.error(error);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const levelsChanged = tempThreshold !== origTemp || coThreshold !== origCo;

  const handleSaveLevels = async () => {
    setSavingLevels(true);
    setLevelsMsg(null);
    // Thresholds go through a narrow RPC (residents have no direct
    // UPDATE grant on devices - see 20260917080000_resident_alert_
    // threshold_rpc.sql) that only ever touches temp_threshold/
    // co_threshold on the caller's own device.
    const { error } = await supabase.rpc('update_own_device_alert_settings', {
      p_temp_threshold: tempThreshold,
      p_co_threshold: coThreshold,
    });
    if (error) {
      console.error(error);
      setLevelsMsg({ ok: false, text: `Couldn't save: ${error.message}` });
    } else {
      setOrigTemp(tempThreshold);
      setOrigCo(coThreshold);
      setLevelsMsg({ ok: true, text: 'Saved. The device picks up new levels within 10 minutes.' });
    }
    setSavingLevels(false);
  };

  const handleSaveContact = async () => {
    if (!profile) return;
    const normalized = contactNumber.trim() ? normalizePhone(contactNumber) : '';
    if (normalized && !PHONE_PATTERN.test(normalized)) {
      setContactMsg({ ok: false, text: PHONE_ERROR });
      return;
    }
    setSavingContact(true);
    setContactMsg(null);
    // The resident's own contact number lives on their profile, not on the
    // device - covered by the existing "Users can update own profile" RLS policy.
    const { error } = await supabase.from('profiles').update({ contact_number: normalized || null }).eq('id', profile.id);
    if (error) {
      console.error(error);
      setContactMsg({ ok: false, text: `Couldn't save: ${error.message}` });
    } else {
      setContactNumber(normalized);
      setOrigContact(normalized);
      setContactMsg({ ok: true, text: normalized ? 'Saved.' : 'Removed. You will get no SMS alerts.' });
    }
    setSavingContact(false);
  };

  const handleTogglePush = async () => {
    setPushBusy(true);
    setChannelError('');
    try {
      if (pushState === 'on') {
        await unsubscribeUserFromPush();
        setPushState('off');
      } else {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          await subscribeUserToPush();
          setPushState('on');
        } else {
          setChannelError('Notifications are blocked for this site in your browser settings.');
        }
      }
    } catch (e: unknown) {
      console.error(e);
      setChannelError(describePushError(e, await isBraveBrowser()));
    } finally {
      setPushBusy(false);
    }
  };

  const handleConnectTelegram = async () => {
    if (!profile) return;
    setChannelError('');
    const message = await startTelegramLink();
    if (message) setChannelError(message);
  };

  if (loading) return <AlertSettingsSkeleton />;
  if (!device) return <NoDeviceLinked />;

  // Threshold safety warnings
  const tempWarning = tempThreshold < 40 ? 'Very low — may cause frequent false alarms' : tempThreshold > 80 ? 'Very high — a fire may go undetected' : null;
  const coWarning = coThreshold < 100 ? 'Very sensitive — expect frequent alerts' : coThreshold > 800 ? 'Very high — a fire may go undetected' : null;

  const savedContact = !!origContact;

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        title="Alert Settings"
        description="Choose the temperature and carbon monoxide (CO) levels that trigger an alert, and where alerts are sent."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-6 min-w-0">

          {/* Alert levels */}
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Alert Levels</h2>
            <p className="text-xs text-text-subtle mt-0.5">
              One reading over its level raises a warning; both together raise a fire alert.
            </p>
            <div className="flex flex-col gap-8 mt-6">
              <LevelSlider
                id="temp-threshold" icon={Thermometer} label="Temperature"
                value={tempThreshold} original={origTemp} unit="°C" min={0} max={100}
                onChange={setTempThreshold} warning={tempWarning}
              />
              <LevelSlider
                id="co-threshold" icon={Wind} label="Carbon Monoxide (CO)"
                value={coThreshold} original={origCo} unit="ppm" min={0} max={1000} step={10}
                onChange={setCoThreshold} warning={coWarning}
              >
                {/* The MQ-7 reports a resistance change that the firmware converts to ppm
                    with the datasheet curve and an uncalibrated baseline, so values are estimates. */}
                <p className="text-xs text-text-subtle leading-relaxed">
                  CO readings are approximate. The gas sensor estimates ppm from its datasheet curve, so use this as an alert level rather than an exact measurement.
                </p>
              </LevelSlider>
            </div>

            <div className="mt-8 pt-5 border-t border-border-warm flex flex-col sm:flex-row sm:items-center gap-3">
              <button type="button" onClick={handleSaveLevels} disabled={savingLevels || !levelsChanged} className={BTN_PRIMARY}>
                <Save className="w-4 h-4" />
                {savingLevels ? 'Saving...' : 'Save alert levels'}
              </button>
              {levelsChanged && (
                <button type="button" onClick={() => { setTempThreshold(origTemp); setCoThreshold(origCo); setLevelsMsg(null); }} className={BTN_SECONDARY}>
                  Undo changes
                </button>
              )}
              {levelsMsg ? (
                <p role="status" className={`text-xs font-semibold ${levelsMsg.ok ? 'text-success-dark' : 'text-primary'}`}>{levelsMsg.text}</p>
              ) : levelsChanged ? (
                <p className="text-xs font-semibold text-[#B45309]">Unsaved changes</p>
              ) : null}
            </div>
          </section>

          {/* Where alerts are sent */}
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Where Alerts Are Sent</h2>
            <p className="text-xs text-text-subtle mt-0.5">
              You receive fire alerts (Tier 2) on each channel turned on here. Warnings (Tier 1) show on your dashboard.
            </p>
            <ul className="mt-6 flex flex-col divide-y divide-border-warm">
              <ChannelRow
                icon={Phone} title="SMS"
                detail="Sent by the device itself over the mobile network, so it works even without internet."
                status={savedContact ? 'On' : 'Not set'} tone={savedContact ? 'ok' : 'warn'}
              >
                <label htmlFor="sms-number" className="sr-only">Mobile number for SMS alerts</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    id="sms-number"
                    type="tel"
                    inputMode="tel"
                    placeholder="09XXXXXXXXX"
                    value={contactNumber}
                    onChange={(e) => { setContactNumber(e.target.value); setContactMsg(null); }}
                    aria-invalid={contactMsg ? !contactMsg.ok : false}
                    className={`h-10 w-full sm:max-w-xs px-3 border rounded-lg bg-surface-card text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary ${contactMsg && !contactMsg.ok ? 'border-primary' : 'border-border'}`}
                  />
                  <button
                    type="button"
                    onClick={handleSaveContact}
                    disabled={savingContact || normalizePhone(contactNumber) === origContact}
                    className={BTN_SECONDARY}
                  >
                    {savingContact ? 'Saving...' : 'Save number'}
                  </button>
                </div>
                {contactMsg && (
                  <p role={contactMsg.ok ? 'status' : 'alert'} className={`text-xs font-semibold mt-2 ${contactMsg.ok ? 'text-success-dark' : 'text-primary'}`}>{contactMsg.text}</p>
                )}
              </ChannelRow>

              <ChannelRow
                icon={pushState === 'on' ? Bell : BellOff} title="Push notifications"
                detail="Shown by this browser, even when AgapSense isn't open. Turn it on in each browser you use."
                status={pushState === 'checking' ? 'Checking' : pushState === 'on' ? 'On' : pushState === 'off' ? 'Off' : 'Unavailable'}
                tone={pushState === 'on' ? 'ok' : pushState === 'off' ? 'warn' : 'none'}
              >
                {pushState === 'unavailable' ? (
                  <p className="text-xs text-text-subtle">This browser doesn't support push notifications, or they're blocked here.</p>
                ) : (
                  <button type="button" onClick={handleTogglePush} disabled={pushBusy || pushState === 'checking'} className={BTN_SECONDARY}>
                    {pushState === 'on' ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                    {pushBusy ? 'Working...' : pushState === 'on' ? 'Turn off' : 'Turn on'}
                  </button>
                )}
              </ChannelRow>

              <ChannelRow
                icon={Send} title="Telegram"
                detail="Fire alerts sent to your Telegram app through the AgapSense bot."
                status={profile?.telegram_chat_id ? 'Linked' : 'Not linked'}
                tone={profile?.telegram_chat_id ? 'ok' : 'warn'}
              >
                <button type="button" onClick={handleConnectTelegram} className={BTN_SECONDARY}>
                  <Send className="w-4 h-4" />
                  {profile?.telegram_chat_id ? 'Link again' : 'Link Telegram'}
                </button>
              </ChannelRow>
            </ul>
            {channelError && (
              <p role="alert" className="mt-4 flex items-center gap-2 text-xs font-semibold text-primary">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {channelError}
              </p>
            )}
          </section>
        </div>

        {/* Side column */}
        <div className="lg:col-span-1 flex flex-col gap-6 min-w-0">
          <section className={CARD}>
            <div className="flex gap-3">
              <HelpCircle className="w-5 h-5 text-primary shrink-0" />
              <div>
                <h2 className="text-sm font-bold text-text">Not sure which levels to use?</h2>
                <p className="text-xs text-text-subtle leading-relaxed mt-1">
                  Kitchens and garages usually need higher levels than bedrooms to avoid false alarms.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsAdviceModalOpen(true)}
              aria-haspopup="dialog"
              className="mt-4 inline-flex items-center gap-1 text-primary-dark font-bold text-xs hover:underline"
            >
              Suggested levels by room <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </section>
        </div>
      </div>

      {/* Threshold Advice Modal */}
      {isAdviceModalOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setIsAdviceModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col relative"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-white border-b border-border px-6 py-4 flex items-center justify-between z-10 rounded-t-xl">
              <h2 id="modal-title" className="text-lg font-bold text-text">Recommended Sensor Thresholds & Guidelines</h2>
              <button
                onClick={() => setIsAdviceModalOpen(false)}
                className="text-text-subtle hover:text-text transition-colors p-1 rounded-full hover:bg-surface-alt focus:outline-none focus:ring-2 focus:ring-primary"
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 flex flex-col gap-8">

              {/* Reference Table */}
              <div className={TABLE_CARD}>
                <TableScroll>
                  <table className={TABLE}>
                    <thead>
                      <tr className={THEAD_ROW}>
                        <th className={TH}>Room / Environment</th>
                        <th className={TH}>Recommended Temp (°C)</th>
                        <th className={TH}>Recommended CO (ppm)</th>
                        <th className={TH}>Considerations</th>
                      </tr>
                    </thead>
                    <tbody className="text-text-body">
                      <tr className={TR}>
                        <td className={`${TD} font-bold text-text`}>Bedrooms & Living Areas</td>
                        <td className={`${TD} whitespace-nowrap`}>50°C – 54°C</td>
                        <td className={`${TD} whitespace-nowrap`}>80 – 120 ppm</td>
                        <td className={TD}>Life-safety priority; high sensitivity for early sleep evacuation.</td>
                      </tr>
                      <tr className={TR}>
                        <td className={`${TD} font-bold text-text`}>Kitchens & Dining</td>
                        <td className={`${TD} whitespace-nowrap`}>58°C – 65°C</td>
                        <td className={`${TD} whitespace-nowrap`}>250 – 350 ppm</td>
                        <td className={TD}>High ambient heat & cooking fumes; prevents false alarms.</td>
                      </tr>
                      <tr className={TR}>
                        <td className={`${TD} font-bold text-text`}>Server / Equipment Closets</td>
                        <td className={`${TD} whitespace-nowrap`}>40°C – 45°C</td>
                        <td className={`${TD} whitespace-nowrap`}>50 – 80 ppm</td>
                        <td className={TD}>Low tolerance for heat buildup; sensitive hardware protection.</td>
                      </tr>
                      <tr className={TR}>
                        <td className={`${TD} font-bold text-text`}>Offices / Public Halls (e.g., Barangay Hall)</td>
                        <td className={`${TD} whitespace-nowrap`}>50°C – 55°C</td>
                        <td className={`${TD} whitespace-nowrap`}>150 – 200 ppm</td>
                        <td className={TD}>Balanced for regular foot traffic and ambient dust.</td>
                      </tr>
                      <tr className={TR}>
                        <td className={`${TD} font-bold text-text`}>Garages & Utility Areas</td>
                        <td className={`${TD} whitespace-nowrap`}>58°C – 60°C</td>
                        <td className={`${TD} whitespace-nowrap`}>250 – 300 ppm</td>
                        <td className={TD}>Tolerates vehicle exhaust surges and utility equipment heat.</td>
                      </tr>
                    </tbody>
                  </table>
                </TableScroll>
              </div>

              {/* Environmental Factors */}
              <div>
                <h3 className="text-sm font-bold tracking-widest uppercase text-primary mb-3">Environmental Factors</h3>
                <ul className="space-y-3 text-sm text-text-body">
                  <li className="flex gap-2">
                    <span className="text-primary shrink-0 mt-0.5">•</span>
                    <div>
                      <strong className="text-text">Ambient Climate:</strong> Uninsulated roofing or tropical summer heat can elevate baselines past 38°C–40°C.
                    </div>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-primary shrink-0 mt-0.5">•</span>
                    <div>
                      <strong className="text-text">Ventilation & Airflow:</strong> Fans or AC returns can carry smoke and CO away from the device.
                    </div>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-primary shrink-0 mt-0.5">•</span>
                    <div>
                      <strong className="text-text">Ceiling Height:</strong> High/vaulted ceilings delay heat build-up and dilute smoke and CO at the device.
                    </div>
                  </li>
                </ul>
              </div>

              {/* References & Standards Footnote */}
              <div className="bg-surface border border-border rounded-lg p-5">
                <h4 className="text-xs font-bold text-text mb-2 uppercase tracking-wide">References & Standards</h4>
                <ul className="space-y-2 text-[11px] text-text-subtle leading-relaxed">
                  <li>
                    <strong className="text-text-body">NFPA 72 (National Fire Alarm and Signaling Code):</strong> Standard fixed-temperature heat detector operating ratings (ordinary temperature classification typically begins at 57°C / 135°F; kitchens/utilities adjusted to intermediate ratings).
                  </li>
                  <li>
                    <strong className="text-text-body">Revised Fire Code of the Philippines (RA 9514 / RIRR):</strong> Standards on automatic detection, notification appliances, and occupancy hazard classifications.
                  </li>
                  <li>
                    <strong className="text-text-body">UL 268 / UL 521 Standards:</strong> Specifications for smoke and heat detector response sensitivities and nuisance-alarm resistance.
                  </li>
                </ul>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
};
