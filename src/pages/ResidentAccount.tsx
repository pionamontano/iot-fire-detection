import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Settings, Save, CheckCircle2, User, Phone, Shield, Calendar, AlertTriangle, Cpu } from 'lucide-react';
import { ProfileSkeleton } from '../components/SkeletonLoaders';

export const ResidentAccount = () => {
  const { profile } = useAuth();
  const [fullName, setFullName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [deviceCode, setDeviceCode] = useState('');

  const [origName, setOrigName] = useState('');
  const [origContact, setOrigContact] = useState('');

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setContactNumber(profile.contact_number || '');
      setOrigName(profile.full_name || '');
      setOrigContact(profile.contact_number || '');
      
      if (profile.device_id) {
        fetchDevice(profile.device_id);
      }
    }
  }, [profile]);

  const fetchDevice = async (id: string) => {
    const { data } = await supabase.from('devices_safe').select('device_code').eq('id', id).single();
    if (data) setDeviceCode(data.device_code);
  };

  useEffect(() => {
    setHasChanges(fullName !== origName || contactNumber !== origContact);
  }, [fullName, contactNumber, origName, origContact]);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 11);
    setContactNumber(value);
  };

  const handleSave = async () => {
    if (!profile) return;

    if (contactNumber && !/^09\d{9}$/.test(contactNumber)) {
      setErrorMsg("Contact number must be 11 digits starting with 09");
      setTimeout(() => setErrorMsg(''), 5000);
      return;
    }

    setSaving(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          contact_number: contactNumber.trim() || null,
        })
        .eq('id', profile.id);

      if (error) throw error;

      setOrigName(fullName.trim());
      setOrigContact(contactNumber.trim());
      setSuccessMsg('Account details saved successfully!');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (e: any) {
      console.error(e);
      setErrorMsg('Failed to save: ' + (e.message || 'Unknown error'));
      setTimeout(() => setErrorMsg(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  if (!profile) return <ProfileSkeleton />;

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[#DC2626]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]" />
          <span className="text-[10px] font-bold uppercase tracking-[0.1em]">User Profile</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-[#18181B]">Account Settings</h1>
        <p className="text-sm text-[#52525B] mt-1">Manage your personal information and contact details.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Form */}
        <div className="lg:col-span-2 bg-white border border-[#E4E4E7] rounded-lg p-8">
          <h2 className="text-lg font-black tracking-tight text-[#18181B] mb-6">Personal Details</h2>

          <div className="flex flex-col gap-6">
            <div>
              <label className="block text-xs font-bold text-[#52525B] mb-1.5 uppercase tracking-[0.1em]">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A1A1AA]" />
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-[#FCF9F8] border border-[#E4E4E7] rounded-md text-sm text-[#18181B] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C]/30 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#52525B] mb-1.5 uppercase tracking-[0.1em]">Contact Number</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A1A1AA]" />
                <input
                  type="tel"
                  value={contactNumber}
                  onChange={handlePhoneChange}
                  maxLength={11}
                  placeholder="09XXXXXXXXX"
                  className="w-full pl-10 pr-4 py-3 bg-[#FCF9F8] border border-[#E4E4E7] rounded-md text-sm text-[#18181B] placeholder-[#A1A1AA] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C]/30 transition-all"
                />
              </div>
              <p className="text-[10px] text-[#A1A1AA] mt-2">This number will be used for SMS notifications if configured by your administrator.</p>
            </div>

            <div className="flex gap-3 mt-2 border-t border-[#E4E4E7] pt-6">
              <button
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="flex-1 py-3 bg-gradient-to-b from-[#18181B] to-black text-white text-sm font-bold rounded-lg hover:from-black hover:to-black transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? 'SAVING...' : hasChanges ? 'SAVE CHANGES' : 'NO CHANGES'}
              </button>
            </div>

            {successMsg && (
              <div className="flex items-center gap-2 justify-center text-sm font-bold text-[#00799C]">
                <CheckCircle2 className="w-4 h-4" /> {successMsg}
              </div>
            )}
            {errorMsg && (
              <div className="flex items-center gap-2 justify-center text-sm font-bold text-[#DC2626]">
                <AlertTriangle className="w-4 h-4" /> {errorMsg}
              </div>
            )}
          </div>
        </div>

        {/* Account Info Sidebar */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <div className="bg-[#FCF9F8] border border-[#E4E4E7] rounded-lg p-6">
            <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-[#52525B] mb-4">Account Overview</h3>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-[#B91C1C]" />
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-[#A1A1AA] block">Role</span>
                  <span className="text-sm font-bold text-[#18181B]">Resident / Owner</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Cpu className="w-4 h-4 text-[#B91C1C]" />
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-[#A1A1AA] block">Assigned Unit</span>
                  <span className="text-sm font-bold text-[#18181B]">{deviceCode || 'None'}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-[#B91C1C]" />
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-[#A1A1AA] block">Registered On</span>
                  <span className="text-sm font-bold text-[#18181B]">{new Date(profile.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};