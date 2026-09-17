import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Device } from '../lib/supabase';
import { Thermometer, Wind, MessageSquare, CheckCircle2, ShieldAlert, HelpCircle, AlertTriangle, Save } from 'lucide-react';
import { AlertSettingsSkeleton } from '../components/SkeletonLoaders';

export const ResidentAlertSettings = () => {
  const { profile } = useAuth();
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [contactError, setContactError] = useState('');

  // Form State
  const [tempThreshold, setTempThreshold] = useState(55);
  const [smokeThreshold, setSmokeThreshold] = useState(300);
  const [contactNumber, setContactNumber] = useState('');
  
  // Original values (to track changes)
  const [origTemp, setOrigTemp] = useState(55);
  const [origSmoke, setOrigSmoke] = useState(300);
  const [origContact, setOrigContact] = useState('');

  useEffect(() => {
    if (profile?.device_id) {
      fetchDevice(profile.device_id);
    } else if (profile) {
      setLoading(false);
    }
  }, [profile]);

  // Track changes
  useEffect(() => {
    setHasChanges(
      tempThreshold !== origTemp || 
      smokeThreshold !== origSmoke || 
      contactNumber !== origContact
    );
  }, [tempThreshold, smokeThreshold, contactNumber, origTemp, origSmoke, origContact]);

  const fetchDevice = async (deviceId: string) => {
    try {
      const { data, error } = await supabase.from('devices_safe').select('*').eq('id', deviceId).single();
      if (data) {
        setDevice(data);
        setTempThreshold(data.temp_threshold || 55);
        setSmokeThreshold(data.co_threshold || 300);
        setContactNumber(data.bfp_contact || '');
        setOrigTemp(data.temp_threshold || 55);
        setOrigSmoke(data.co_threshold || 300);
        setOrigContact(data.bfp_contact || '');
      }
      if (error) console.error(error);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!device) return;
    
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
      const { error } = await supabase
        .from('devices')
        .update({
          temp_threshold: tempThreshold,
          co_threshold: smokeThreshold,
          bfp_contact: contactNumber || null,
        })
        .eq('id', device.id);
      
      if (error) {
        throw error;
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

          {/* Marketing/Info Image Card */}
          <div className="bg-[#18181B] rounded-lg p-6 relative overflow-hidden h-48 flex items-end shadow-md group">
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent z-10" />
            <div className="absolute inset-0 bg-[#3F3F46] group-hover:scale-105 transition-transform duration-700 ease-in-out flex items-center justify-center">
              <ShieldAlert size={64} className="text-white/20" />
            </div>
            
            <div className="relative z-20">
              <h4 className="text-white font-bold text-lg leading-tight mb-1">Precision Monitoring</h4>
              <p className="text-white/70 text-[10px]">Vigilant Guardian Series 7x Sensors</p>
            </div>
          </div>

          {/* Advice Card */}
          <div className="bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg p-5 flex gap-4 shadow-sm">
            <HelpCircle size={20} className="text-[#DC2626] shrink-0" />
            <div>
              <h4 className="text-xs font-bold text-[#18181B] mb-1">Need threshold advice?</h4>
              <p className="text-[10px] text-[#71717A] leading-relaxed">
                Standard residential safety profiles typically use a 50°C trigger. For industrial kitchens, consider 65°C to avoid false positives.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
