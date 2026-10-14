import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { Device } from '../../lib/supabase';
import { Thermometer, Wind, MessageSquare, CheckCircle2, HelpCircle, AlertTriangle, Save, Send, X } from 'lucide-react';
import { AlertSettingsSkeleton } from '../../components/SkeletonLoaders';
import { TABLE_CARD, TABLE, THEAD_ROW, TH, TR, TD, TableScroll } from '../../components/Table';
import { subscribeUserToPush, unsubscribeUserFromPush, getPushSubscription, describePushError, isBraveBrowser } from '../../lib/pushNotifications';
import { startTelegramLink } from '../../lib/telegramLink';
import { Bell, BellOff } from 'lucide-react';
import { displayAddress } from '../../lib/location';
import { PageHeader } from '../../components/PageHeader';


export const ResidentAlertSettings = () => {
  const { profile } = useAuth();
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [contactError, setContactError] = useState('');

  const [isPushSubscribed, setIsPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(true);


  // Form State
  const [tempThreshold, setTempThreshold] = useState(55);
  const [coThreshold, setCoThreshold] = useState(300);
  const [contactNumber, setContactNumber] = useState('');
  
  // Original values (to track changes)
  const [origTemp, setOrigTemp] = useState(55);
  const [origCo, setOrigCo] = useState(300);
  const [origContact, setOrigContact] = useState('');

  const [isAdviceModalOpen, setIsAdviceModalOpen] = useState(false);

  useEffect(() => {
    if (profile?.device_id) {
      fetchDevice(profile.device_id);
      getPushSubscription().then(sub => {
        setIsPushSubscribed(!!sub);
        setPushLoading(false);
      });

    } else if (profile) {
      setLoading(false);
    }
  }, [profile]);

  // Track changes
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsAdviceModalOpen(false);
    };
    if (isAdviceModalOpen) {
      window.addEventListener('keydown', handleEsc);
    }
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isAdviceModalOpen]);

  useEffect(() => {
    setHasChanges(
      tempThreshold !== origTemp || 
      coThreshold !== origCo || 
      contactNumber !== origContact
    );
  }, [tempThreshold, coThreshold, contactNumber, origTemp, origCo, origContact]);



  const handleTogglePush = async () => {
    setPushLoading(true);
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
          setErrorMsg('Notification permission denied by browser.');
          setTimeout(() => setErrorMsg(''), 5000);
        }
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(describePushError(e, await isBraveBrowser()));
      setTimeout(() => setErrorMsg(''), 5000);
    } finally {
      setPushLoading(false);
    }
  };

const handleConnectTelegram = async () => {
    if (!profile) return;
    const message = await startTelegramLink();
    if (message) {
      setErrorMsg(message);
      setTimeout(() => setErrorMsg(''), 5000);
    }
  };

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
      // The number that actually receives the resident's own evacuation
      // SMS is profiles.contact_number (see trigger-alert's owner_contact
      // lookup) - not devices.bfp_contact, which is the fire station's
      // own contact number used for the technical BFP dispatch SMS. This
      // page used to read/write bfp_contact by mistake, which meant
      // "saving your SMS recipient" here would have overwritten the
      // number the fire department gets alerted on for this device.
      const contact = profile?.contact_number || '';
      setContactNumber(contact);
      setOrigContact(contact);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!device || !profile) return;

    // Validate contact number format if provided
    const phoneRegex = /^(09\d{9})$/;
    if (contactNumber && !phoneRegex.test(contactNumber)) {
      setContactError('Enter a valid Philippine mobile number (e.g. 09171234567).');
      return;
    }
    setContactError('');
    setSaving(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      // Thresholds go through a narrow RPC (residents have no direct
      // UPDATE grant on devices - see 20260917080000_resident_alert_
      // threshold_rpc.sql) that only ever touches temp_threshold/
      // co_threshold on the caller's own device.
      const { error: thresholdError } = await supabase.rpc('update_own_device_alert_settings', {
        p_temp_threshold: tempThreshold,
        p_co_threshold: coThreshold,
      });
      if (thresholdError) throw thresholdError;

      // The resident's own contact number lives on their profile, not
      // on the device - already covered by the existing "Users can
      // update own profile" RLS policy.
      if (contactNumber !== origContact) {
        const { error: contactUpdateError } = await supabase
          .from('profiles')
          .update({ contact_number: contactNumber || null })
          .eq('id', profile.id);
        if (contactUpdateError) throw contactUpdateError;
      }

      // Update originals so hasChanges resets
      setOrigTemp(tempThreshold);
      setOrigCo(coThreshold);
      setOrigContact(contactNumber);
      setSuccessMsg('Settings saved successfully!');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (e: any) {
      console.error(e);
      setErrorMsg('Failed to save: ' + (e.message || 'Unknown error'));
      setTimeout(() => setErrorMsg(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setTempThreshold(origTemp);
    setCoThreshold(origCo);
    setContactNumber(origContact);
  };

  if (loading) return <AlertSettingsSkeleton />;
  if (!device) return <div className="p-8 font-bold text-primary">No device registered to your account.</div>;

  // Threshold safety warnings
  const tempWarning = tempThreshold < 40 ? 'Very low — may cause frequent false alarms' : tempThreshold > 80 ? 'Dangerously high — fire may go undetected' : null;
  const coWarning = coThreshold < 100 ? 'Very sensitive — expect frequent alerts' : coThreshold > 800 ? 'Very high — a fire may go undetected' : null;

  return (
    <div className="flex flex-col gap-8 pb-12">
      <PageHeader
        title="Alert Settings"
        description="Choose the temperature and carbon monoxide (CO) levels that trigger an alert, and where alerts are sent."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Settings Form (2/3) */}
        <div className="lg:col-span-2 bg-surface border border-border rounded-lg p-8">
          
          <div className="flex flex-col gap-10">
            {/* Temp Threshold */}
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-end">
                <span className="text-[10px] font-bold tracking-widest uppercase text-text-body">Temperature</span>
                <span className={`text-3xl font-black tracking-tighter ${tempThreshold !== origTemp ? 'text-amber-light' : 'text-primary'}`}>{tempThreshold}°C</span>
              </div>
              <div>
                <span className="text-sm font-bold text-text block mb-4">Temperature Threshold</span>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={tempThreshold} 
                  onChange={(e) => setTempThreshold(Number(e.target.value))}
                  className="w-full h-2 bg-surface-cream rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-[10px] font-bold text-text-faint uppercase mt-2">
                  <span>0°C</span>
                  <span>100°C</span>
                </div>
                {tempWarning && (
                  <div className="flex items-center gap-2 mt-3 text-amber-light">
                    <AlertTriangle size={14} />
                    <span className="text-[10px] font-bold">{tempWarning}</span>
                  </div>
                )}
              </div>
            </div>

            {/* CO Threshold */}
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-end">
                <span className="text-[10px] font-bold tracking-widest uppercase text-text-body">Carbon Monoxide (CO)</span>
                <span className={`text-3xl font-black tracking-tighter ${coThreshold !== origCo ? 'text-amber-light' : 'text-primary'}`}>{coThreshold} ppm</span>
              </div>
              <div>
                <span className="text-sm font-bold text-text block mb-4">CO Threshold</span>
                <input 
                  type="range" 
                  min="0" 
                  max="1000" 
                  step="10"
                  value={coThreshold} 
                  onChange={(e) => setCoThreshold(Number(e.target.value))}
                  className="w-full h-2 bg-surface-cream rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-[10px] font-bold text-text-faint uppercase mt-2">
                  <span>0 ppm</span>
                  <span>1000 ppm</span>
                </div>
                {coWarning && (
                  <div className="flex items-center gap-2 mt-3 text-amber-light">
                    <AlertTriangle size={14} />
                    <span className="text-[10px] font-bold">{coWarning}</span>
                  </div>
                )}
                {/* The MQ-7 reports a resistance change that the firmware converts to ppm
                    with the datasheet curve and an uncalibrated baseline, so values are estimates. */}
                <p className="text-[11px] text-text-subtle leading-relaxed mt-3">
                  CO readings are approximate. The gas sensor estimates ppm from its datasheet curve, so use this as an alert level rather than an exact measurement.
                </p>
              </div>
            </div>

            {/* SMS Recipient */}
            <div className="flex flex-col gap-4 pt-6 border-t border-border">
              <span className="text-[10px] font-bold tracking-widest uppercase text-text-body">PRIMARY SMS RECIPIENT</span>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <MessageSquare size={18} className="text-text-faint" />
                </div>
                <input
                  type="tel"
                  maxLength={11}
                  placeholder="09XXXXXXXXX"
                  value={contactNumber}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setContactNumber(val);
                    if (contactError) setContactError('');
                  }}
                  className={`w-full pl-12 pr-4 py-4 bg-white border rounded-lg text-sm font-medium focus:outline-none focus:ring-1 transition-colors shadow-sm ${contactError ? 'border-primary focus:border-primary focus:ring-primary' : 'border-border focus:border-primary focus:ring-primary'}`}
                />
              </div>
              <p className="text-[10px] text-text-subtle leading-relaxed">
                Philippine number only — e.g. 09171234567. Automated alerts will be dispatched to this number within 150ms of trigger detection.
              </p>
              {contactError && <span className="text-primary text-[11px] font-bold mt-1 block">{contactError}</span>}
            </div>

            <div className="flex gap-3 mt-4">
              <button
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="flex-1 py-4 bg-gradient-to-b from-primary to-primary text-white text-sm font-bold rounded-lg shadow-sm hover:from-accent hover:to-primary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Save size={16} />
                {saving ? 'SAVING...' : hasChanges ? 'SAVE CHANGES' : 'NO CHANGES'}
              </button>
              {hasChanges && (
                <button
                  onClick={handleReset}
                  className="px-6 py-4 bg-surface-cream text-text-body text-sm font-bold rounded-lg hover:bg-border transition-all"
                >
                  RESET
                </button>
              )}
            </div>
            {successMsg && (
              <div className="flex items-center gap-2 justify-center text-sm font-bold text-success">
                <CheckCircle2 size={16} />
                {successMsg}
              </div>
            )}


          {/* Web Push Linking */}
          <div className="bg-white border border-border rounded-xl overflow-hidden shadow-sm mb-6">
            <div className="bg-surface-alt px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-text-subtle" />
                <h3 className="font-bold text-[13px] tracking-wide text-text uppercase">WEB PUSH ALERTS</h3>
              </div>
              {isPushSubscribed ? (
                <div className="flex items-center gap-1.5 text-xs font-bold text-success bg-success/10 px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  ENABLED
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-light bg-amber-light/10 px-2.5 py-1 rounded-full">
                  <BellOff className="w-3.5 h-3.5" />
                  DISABLED
                </div>
              )}
            </div>

            <div className="p-4 sm:p-5">
              <p className="text-[13px] text-text-body leading-relaxed mb-4">
                Receive notifications directly in your browser even when you are not actively looking at the dashboard.
              </p>

              <button
                type="button"
                onClick={handleTogglePush}
                disabled={pushLoading}
                className="w-full sm:w-auto px-5 py-2.5 border border-border bg-surface-card hover:bg-surface text-text-body text-[13px] font-bold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isPushSubscribed ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                {pushLoading ? 'Processing...' : (isPushSubscribed ? 'Disable Push Notifications' : 'Enable Push Notifications')}
              </button>
            </div>
          </div>

          {/* Telegram Linking */}
          <div className="bg-white border border-border rounded-xl overflow-hidden shadow-sm">
            <div className="bg-surface-alt px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-text-subtle" />
                <h3 className="font-bold text-[13px] tracking-wide text-text uppercase">TELEGRAM ALERTS</h3>
              </div>
              {profile?.telegram_chat_id ? (
                <div className="flex items-center gap-1.5 text-xs font-bold text-success bg-success/10 px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  LINKED
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-light bg-amber-light/10 px-2.5 py-1 rounded-full">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  NOT LINKED
                </div>
              )}
            </div>

            <div className="p-4 sm:p-5">
              <p className="text-[13px] text-text-body leading-relaxed mb-4">
                Receive instant fire alerts directly to your Telegram app. This is the fastest and most reliable way to get notified during an emergency.
              </p>

              <button
                type="button"
                onClick={handleConnectTelegram}
                className="w-full sm:w-auto px-5 py-2.5 border border-border bg-surface-card hover:bg-surface text-text-body text-[13px] font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                {profile?.telegram_chat_id ? 'Reconnect Telegram' : 'Link Telegram Account'}
              </button>
            </div>
          </div>


            {errorMsg && (
              <div className="flex items-center gap-2 justify-center text-sm font-bold text-primary">
                <AlertTriangle size={16} />
                {errorMsg}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar (1/3) */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          
          {/* Summary Card */}
          <div className="bg-surface-cream rounded-lg p-6 border-l-4 border-l-primary shadow-inner">
            <h3 className="text-[10px] font-bold tracking-widest uppercase text-primary mb-6">Current Configuration Summary</h3>
            
            <div className="flex flex-col gap-4 mb-6">
              <div className="flex items-center justify-between bg-white p-3 rounded shadow-sm">
                <div className="flex items-center gap-3">
                  <Thermometer size={16} className="text-primary" />
                  <span className="text-xs font-bold text-text">Temperature Threshold</span>
                </div>
                <span className={`text-xs font-black ${tempThreshold !== origTemp ? 'text-amber-light' : 'text-text'}`}>{tempThreshold}°C</span>
              </div>
              <div className="flex items-center justify-between bg-white p-3 rounded shadow-sm">
                <div className="flex items-center gap-3">
                  <Wind size={16} className="text-primary" />
                  <span className="text-xs font-bold text-text">CO Threshold</span>
                </div>
                <span className={`text-xs font-black ${coThreshold !== origCo ? 'text-amber-light' : 'text-text'}`}>{coThreshold} ppm</span>
              </div>
              <div className="flex items-center justify-between bg-white p-3 rounded shadow-sm">
                <div className="flex items-center gap-3">
                  <MessageSquare size={16} className="text-primary" />
                  <span className="text-xs font-bold text-text">Relay Target</span>
                </div>
                <span className="text-xs font-black text-text">{contactNumber || 'NOT SET'}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-4 border-t border-border">
              {hasChanges ? (
                <div className="flex items-center gap-2 text-amber-light">
                  <AlertTriangle size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Unsaved Changes</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-teal-light">
                  <CheckCircle2 size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">All Settings Synced</span>
                </div>
              )}
              <p className="text-[10px] text-text-body leading-relaxed">
                Device: <strong>{device.device_code}</strong> — {displayAddress(device.location_desc)}
              </p>
            </div>
          </div>


          {/* Advice Card */}
          <div
            className="bg-surface border border-border rounded-lg p-5 flex flex-col gap-3 shadow-sm cursor-pointer hover:bg-surface-alt transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
            onClick={() => setIsAdviceModalOpen(true)}
            role="button"
            tabIndex={0}
            aria-haspopup="dialog"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsAdviceModalOpen(true);
              }
            }}
          >
            <div className="flex gap-4">
              <HelpCircle size={20} className="text-primary shrink-0" />
              <div>
                <h4 className="text-xs font-bold text-text mb-1">Need threshold advice?</h4>
                <p className="text-[10px] text-text-subtle leading-relaxed">
                  Standard residential safety profiles typically use a 50°C trigger. For industrial kitchens, consider 65°C to avoid false positives.
                </p>
              </div>
            </div>
            <div className="flex justify-end w-full">
              <span className="text-[10px] font-bold text-primary uppercase tracking-wider flex items-center gap-1 group-hover:underline">
                View Room Guidelines &rarr;
              </span>
            </div>
          </div>

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
