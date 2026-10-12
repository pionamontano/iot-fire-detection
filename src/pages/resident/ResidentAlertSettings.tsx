import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { Device } from '../../lib/supabase';
import { Thermometer, Wind, MessageSquare, CheckCircle2, HelpCircle, AlertTriangle, Save, Send, X } from 'lucide-react';
import { AlertSettingsSkeleton } from '../../components/SkeletonLoaders';
import { subscribeUserToPush, unsubscribeUserFromPush, getPushSubscription } from '../../lib/pushNotifications';
import { Bell, BellOff } from 'lucide-react';


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
  const [smokeThreshold, setSmokeThreshold] = useState(300);
  const [contactNumber, setContactNumber] = useState('');
  
  // Original values (to track changes)
  const [origTemp, setOrigTemp] = useState(55);
  const [origSmoke, setOrigSmoke] = useState(300);
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
      smokeThreshold !== origSmoke || 
      contactNumber !== origContact
    );
  }, [tempThreshold, smokeThreshold, contactNumber, origTemp, origSmoke, origContact]);



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
      setErrorMsg('Push error: ' + (e.message || 'Unknown error'));
      setTimeout(() => setErrorMsg(''), 5000);
    } finally {
      setPushLoading(false);
    }
  };

const handleConnectTelegram = async () => {
    if (!profile) return;
    const botUsername = "AgapSenseAlertBot";
    // Open the window synchronously so popup blockers allow it, then point it
    // at the deep link once the one-time token arrives.
    const win = window.open('', '_blank');
    const { data: token, error } = await supabase.rpc('create_telegram_link_token');
    if (error || !token) {
      win?.close();
      console.error(error);
      return;
    }
    const telegramUrl = `https://t.me/${botUsername}?start=${token}`;
    if (win) win.location.href = telegramUrl;
    else window.location.href = telegramUrl;
  };

  const fetchDevice = async (deviceId: string) => {
    try {
      const { data, error } = await supabase.from('devices_safe').select('*').eq('id', deviceId).single();
      if (data) {
        setDevice(data);
        setTempThreshold(data.temp_threshold || 55);
        setSmokeThreshold(data.co_threshold || 300);
        setOrigTemp(data.temp_threshold || 55);
        setOrigSmoke(data.co_threshold || 300);
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
        p_co_threshold: smokeThreshold,
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
      setOrigSmoke(smokeThreshold);
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
    setSmokeThreshold(origSmoke);
    setContactNumber(origContact);
  };

  if (loading) return <AlertSettingsSkeleton />;
  if (!device) return <div className="p-8 font-bold text-[#DC2626]">No device registered to your account.</div>;

  // Threshold safety warnings
  const tempWarning = tempThreshold < 40 ? 'Very low — may cause frequent false alarms' : tempThreshold > 80 ? 'Dangerously high — fire may go undetected' : null;
  const smokeWarning = smokeThreshold < 100 ? 'Very sensitive — expect frequent alerts' : smokeThreshold > 800 ? 'Very high — smoke may go undetected' : null;

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-2 max-w-2xl">
        <div className="flex items-center gap-2 text-[#DC2626]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]"></span>
          <span className="text-[10px] font-bold uppercase tracking-[0.1em]">System Security Configuration</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-[#18181B]">Edit Alert Thresholds</h1>
        <p className="text-sm text-[#52525B] leading-relaxed mt-2">
          Configure precision trigger points for environmental hazards. These parameters define the transition between operational telemetry and emergency protocols.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Settings Form (2/3) */}
        <div className="lg:col-span-2 bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg p-8">
          
          <div className="flex flex-col gap-10">
            {/* Temp Threshold */}
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-end">
                <span className="text-[10px] font-bold tracking-widest uppercase text-[#52525B]">THERMAL TRIGGER</span>
                <span className={`text-3xl font-black tracking-tighter ${tempThreshold !== origTemp ? 'text-[#F59E0B]' : 'text-[#DC2626]'}`}>{tempThreshold}°C</span>
              </div>
              <div>
                <span className="text-sm font-bold text-[#18181B] block mb-4">Temperature Threshold</span>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={tempThreshold} 
                  onChange={(e) => setTempThreshold(Number(e.target.value))}
                  className="w-full h-2 bg-[#E4E4E7] rounded-lg appearance-none cursor-pointer accent-[#DC2626]"
                />
                <div className="flex justify-between text-[10px] font-bold text-[#A1A1AA] uppercase mt-2">
                  <span>AMBIENT (0°C)</span>
                  <span>CRITICAL (100°C)</span>
                </div>
                {tempWarning && (
                  <div className="flex items-center gap-2 mt-3 text-[#F59E0B]">
                    <AlertTriangle size={14} />
                    <span className="text-[10px] font-bold">{tempWarning}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Smoke Threshold */}
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-end">
                <span className="text-[10px] font-bold tracking-widest uppercase text-[#52525B]">PARTICULATE DENSITY</span>
                <span className={`text-3xl font-black tracking-tighter ${smokeThreshold !== origSmoke ? 'text-[#F59E0B]' : 'text-[#DC2626]'}`}>{smokeThreshold}PPM</span>
              </div>
              <div>
                <span className="text-sm font-bold text-[#18181B] block mb-4">Smoke Threshold</span>
                <input 
                  type="range" 
                  min="0" 
                  max="1000" 
                  step="10"
                  value={smokeThreshold} 
                  onChange={(e) => setSmokeThreshold(Number(e.target.value))}
                  className="w-full h-2 bg-[#E4E4E7] rounded-lg appearance-none cursor-pointer accent-[#DC2626]"
                />
                <div className="flex justify-between text-[10px] font-bold text-[#A1A1AA] uppercase mt-2">
                  <span>CLEAR (0 PPM)</span>
                  <span>DENSE (1000 PPM)</span>
                </div>
                {smokeWarning && (
                  <div className="flex items-center gap-2 mt-3 text-[#F59E0B]">
                    <AlertTriangle size={14} />
                    <span className="text-[10px] font-bold">{smokeWarning}</span>
                  </div>
                )}
              </div>
            </div>

            {/* SMS Recipient */}
            <div className="flex flex-col gap-4 pt-6 border-t border-[#E5E2E1]">
              <span className="text-[10px] font-bold tracking-widest uppercase text-[#52525B]">PRIMARY SMS RECIPIENT</span>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <MessageSquare size={18} className="text-[#A1A1AA]" />
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
                  className={`w-full pl-12 pr-4 py-4 bg-white border rounded-lg text-sm font-medium focus:outline-none focus:ring-1 transition-colors shadow-sm ${contactError ? 'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]' : 'border-[#E5E2E1] focus:border-[#DC2626] focus:ring-[#DC2626]'}`}
                />
              </div>
              <p className="text-[10px] text-[#71717A] leading-relaxed">
                Philippine number only — e.g. 09171234567. Automated alerts will be dispatched to this number within 150ms of trigger detection.
              </p>
              {contactError && <span className="text-[#DC2626] text-[11px] font-bold mt-1 block">{contactError}</span>}
            </div>

            <div className="flex gap-3 mt-4">
              <button
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="flex-1 py-4 bg-gradient-to-b from-[#DC2626] to-[#B91C1C] text-white text-sm font-bold rounded-lg shadow-sm hover:from-[#EF4444] hover:to-[#DC2626] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#DC2626] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Save size={16} />
                {saving ? 'SAVING...' : hasChanges ? 'SAVE CHANGES' : 'NO CHANGES'}
              </button>
              {hasChanges && (
                <button
                  onClick={handleReset}
                  className="px-6 py-4 bg-[#E4E4E7] text-[#52525B] text-sm font-bold rounded-lg hover:bg-[#D4D4D8] transition-all"
                >
                  RESET
                </button>
              )}
            </div>
            {successMsg && (
              <div className="flex items-center gap-2 justify-center text-sm font-bold text-[#10B981]">
                <CheckCircle2 size={16} />
                {successMsg}
              </div>
            )}


          {/* Web Push Linking */}
          <div className="bg-white border border-[#E4E4E7] rounded-xl overflow-hidden shadow-sm mb-6">
            <div className="bg-[#F4F4F5] px-4 py-3 border-b border-[#E4E4E7] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-[#71717A]" />
                <h3 className="font-bold text-[13px] tracking-wide text-[#27272A] uppercase">WEB PUSH ALERTS</h3>
              </div>
              {isPushSubscribed ? (
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#10B981] bg-[#10B981]/10 px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  ENABLED
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#F59E0B] bg-[#F59E0B]/10 px-2.5 py-1 rounded-full">
                  <BellOff className="w-3.5 h-3.5" />
                  DISABLED
                </div>
              )}
            </div>

            <div className="p-4 sm:p-5">
              <p className="text-[13px] text-[#52525B] leading-relaxed mb-4">
                Receive notifications directly in your browser even when you are not actively looking at the dashboard.
              </p>

              <button
                type="button"
                onClick={handleTogglePush}
                disabled={pushLoading}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-[13px] font-bold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isPushSubscribed ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                {pushLoading ? 'Processing...' : (isPushSubscribed ? 'Disable Push Notifications' : 'Enable Push Notifications')}
              </button>
            </div>
          </div>

          {/* Telegram Linking */}
          <div className="bg-white border border-[#E4E4E7] rounded-xl overflow-hidden shadow-sm">
            <div className="bg-[#F4F4F5] px-4 py-3 border-b border-[#E4E4E7] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-[#71717A]" />
                <h3 className="font-bold text-[13px] tracking-wide text-[#27272A] uppercase">TELEGRAM ALERTS</h3>
              </div>
              {profile?.telegram_chat_id ? (
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#10B981] bg-[#10B981]/10 px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  LINKED
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#F59E0B] bg-[#F59E0B]/10 px-2.5 py-1 rounded-full">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  NOT LINKED
                </div>
              )}
            </div>

            <div className="p-4 sm:p-5">
              <p className="text-[13px] text-[#52525B] leading-relaxed mb-4">
                Receive instant fire alerts directly to your Telegram app. This is the fastest and most reliable way to get notified during an emergency.
              </p>

              <button
                type="button"
                onClick={handleConnectTelegram}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-[13px] font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                {profile?.telegram_chat_id ? 'Reconnect Telegram' : 'Link Telegram Account'}
              </button>
            </div>
          </div>


            {errorMsg && (
              <div className="flex items-center gap-2 justify-center text-sm font-bold text-[#DC2626]">
                <AlertTriangle size={16} />
                {errorMsg}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar (1/3) */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          
          {/* Summary Card */}
          <div className="bg-[#E5E5E5] rounded-lg p-6 border-l-4 border-l-[#DC2626] shadow-inner">
            <h3 className="text-[10px] font-bold tracking-widest uppercase text-[#DC2626] mb-6">Current Configuration Summary</h3>
            
            <div className="flex flex-col gap-4 mb-6">
              <div className="flex items-center justify-between bg-white p-3 rounded shadow-sm">
                <div className="flex items-center gap-3">
                  <Thermometer size={16} className="text-[#DC2626]" />
                  <span className="text-xs font-bold text-[#18181B]">Active Temp Ceiling</span>
                </div>
                <span className={`text-xs font-black ${tempThreshold !== origTemp ? 'text-[#F59E0B]' : 'text-[#18181B]'}`}>{tempThreshold}°C</span>
              </div>
              <div className="flex items-center justify-between bg-white p-3 rounded shadow-sm">
                <div className="flex items-center gap-3">
                  <Wind size={16} className="text-[#DC2626]" />
                  <span className="text-xs font-bold text-[#18181B]">Smoke Sensitivity</span>
                </div>
                <span className={`text-xs font-black ${smokeThreshold !== origSmoke ? 'text-[#F59E0B]' : 'text-[#18181B]'}`}>{smokeThreshold} PPM</span>
              </div>
              <div className="flex items-center justify-between bg-white p-3 rounded shadow-sm">
                <div className="flex items-center gap-3">
                  <MessageSquare size={16} className="text-[#DC2626]" />
                  <span className="text-xs font-bold text-[#18181B]">Relay Target</span>
                </div>
                <span className="text-xs font-black text-[#18181B]">{contactNumber || 'NOT SET'}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-4 border-t border-[#D4D4D4]">
              {hasChanges ? (
                <div className="flex items-center gap-2 text-[#F59E0B]">
                  <AlertTriangle size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Unsaved Changes</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-[#00799C]">
                  <CheckCircle2 size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">All Settings Synced</span>
                </div>
              )}
              <p className="text-[10px] text-[#52525B] leading-relaxed">
                Device: <strong>{device.device_code}</strong> — {device.location_desc}
              </p>
            </div>
          </div>


          {/* Advice Card */}
          <div
            className="bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg p-5 flex flex-col gap-3 shadow-sm cursor-pointer hover:bg-[#F3EFEF] transition-colors focus:outline-none focus:ring-2 focus:ring-[#DC2626]"
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
              <HelpCircle size={20} className="text-[#DC2626] shrink-0" />
              <div>
                <h4 className="text-xs font-bold text-[#18181B] mb-1">Need threshold advice?</h4>
                <p className="text-[10px] text-[#71717A] leading-relaxed">
                  Standard residential safety profiles typically use a 50°C trigger. For industrial kitchens, consider 65°C to avoid false positives.
                </p>
              </div>
            </div>
            <div className="flex justify-end w-full">
              <span className="text-[10px] font-bold text-[#DC2626] uppercase tracking-wider flex items-center gap-1 group-hover:underline">
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
            <div className="sticky top-0 bg-white border-b border-[#E5E2E1] px-6 py-4 flex items-center justify-between z-10 rounded-t-xl">
              <h2 id="modal-title" className="text-lg font-bold text-[#18181B]">Recommended Sensor Thresholds & Guidelines</h2>
              <button
                onClick={() => setIsAdviceModalOpen(false)}
                className="text-[#71717A] hover:text-[#18181B] transition-colors p-1 rounded-full hover:bg-[#F4F4F5] focus:outline-none focus:ring-2 focus:ring-[#DC2626]"
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 flex flex-col gap-8">

              {/* Reference Table */}
              <div className="overflow-x-auto border border-[#E5E2E1] rounded-lg shadow-sm">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-[#F4F4F5] text-[#18181B] border-b border-[#E5E2E1]">
                      <th className="p-3 font-bold border-r border-[#E5E2E1]">Room / Environment</th>
                      <th className="p-3 font-bold border-r border-[#E5E2E1]">Recommended Temp (°C)</th>
                      <th className="p-3 font-bold border-r border-[#E5E2E1]">Recommended Smoke (PPM)</th>
                      <th className="p-3 font-bold">Considerations</th>
                    </tr>
                  </thead>
                  <tbody className="text-[#52525B]">
                    <tr className="border-b border-[#E5E2E1] hover:bg-[#FCF9F8]">
                      <td className="p-3 font-bold text-[#18181B] border-r border-[#E5E2E1]">Bedrooms & Living Areas</td>
                      <td className="p-3 border-r border-[#E5E2E1]">50°C – 54°C</td>
                      <td className="p-3 border-r border-[#E5E2E1]">80 – 120 PPM</td>
                      <td className="p-3">Life-safety priority; high sensitivity for early sleep evacuation.</td>
                    </tr>
                    <tr className="border-b border-[#E5E2E1] hover:bg-[#FCF9F8]">
                      <td className="p-3 font-bold text-[#18181B] border-r border-[#E5E2E1]">Kitchens & Dining</td>
                      <td className="p-3 border-r border-[#E5E2E1]">58°C – 65°C</td>
                      <td className="p-3 border-r border-[#E5E2E1]">250 – 350 PPM</td>
                      <td className="p-3">High ambient heat & cooking fumes; prevents false alarms.</td>
                    </tr>
                    <tr className="border-b border-[#E5E2E1] hover:bg-[#FCF9F8]">
                      <td className="p-3 font-bold text-[#18181B] border-r border-[#E5E2E1]">Server / Equipment Closets</td>
                      <td className="p-3 border-r border-[#E5E2E1]">40°C – 45°C</td>
                      <td className="p-3 border-r border-[#E5E2E1]">50 – 80 PPM</td>
                      <td className="p-3">Low tolerance for heat buildup; sensitive hardware protection.</td>
                    </tr>
                    <tr className="border-b border-[#E5E2E1] hover:bg-[#FCF9F8]">
                      <td className="p-3 font-bold text-[#18181B] border-r border-[#E5E2E1]">Offices / Public Halls (e.g., Barangay Hall)</td>
                      <td className="p-3 border-r border-[#E5E2E1]">50°C – 55°C</td>
                      <td className="p-3 border-r border-[#E5E2E1]">150 – 200 PPM</td>
                      <td className="p-3">Balanced for regular foot traffic and ambient dust.</td>
                    </tr>
                    <tr className="hover:bg-[#FCF9F8]">
                      <td className="p-3 font-bold text-[#18181B] border-r border-[#E5E2E1]">Garages & Utility Areas</td>
                      <td className="p-3 border-r border-[#E5E2E1]">58°C – 60°C</td>
                      <td className="p-3 border-r border-[#E5E2E1]">250 – 300 PPM</td>
                      <td className="p-3">Tolerates vehicle exhaust surges and utility equipment heat.</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Environmental Factors */}
              <div>
                <h3 className="text-sm font-bold tracking-widest uppercase text-[#DC2626] mb-3">Environmental Factors</h3>
                <ul className="space-y-3 text-sm text-[#52525B]">
                  <li className="flex gap-2">
                    <span className="text-[#DC2626] shrink-0 mt-0.5">•</span>
                    <div>
                      <strong className="text-[#18181B]">Ambient Climate:</strong> Uninsulated roofing or tropical summer heat can elevate baselines past 38°C–40°C.
                    </div>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[#DC2626] shrink-0 mt-0.5">•</span>
                    <div>
                      <strong className="text-[#18181B]">Ventilation & Airflow:</strong> Fans or AC returns can disperse smoke plumes away from ceiling sensors.
                    </div>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[#DC2626] shrink-0 mt-0.5">•</span>
                    <div>
                      <strong className="text-[#18181B]">Ceiling Height:</strong> High/vaulted ceilings create thermal lag and smoke dilution.
                    </div>
                  </li>
                </ul>
              </div>

              {/* References & Standards Footnote */}
              <div className="bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg p-5">
                <h4 className="text-xs font-bold text-[#18181B] mb-2 uppercase tracking-wide">References & Standards</h4>
                <ul className="space-y-2 text-[11px] text-[#71717A] leading-relaxed">
                  <li>
                    <strong className="text-[#52525B]">NFPA 72 (National Fire Alarm and Signaling Code):</strong> Standard fixed-temperature heat detector operating ratings (ordinary temperature classification typically begins at 57°C / 135°F; kitchens/utilities adjusted to intermediate ratings).
                  </li>
                  <li>
                    <strong className="text-[#52525B]">Revised Fire Code of the Philippines (RA 9514 / RIRR):</strong> Standards on automatic detection, notification appliances, and occupancy hazard classifications.
                  </li>
                  <li>
                    <strong className="text-[#52525B]">UL 268 / UL 521 Standards:</strong> Specifications for smoke and heat detector response sensitivities and nuisance-alarm resistance.
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
