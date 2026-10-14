import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Save, CheckCircle2, User, Phone, Shield, Calendar, AlertTriangle, Cpu, Settings, Mail } from 'lucide-react';
import { ProfileSkeleton } from '../../components/SkeletonLoaders';
import { AdminSupportModal } from '../../components/AdminSupportModal';
import { MySupportRequests } from '../../components/MySupportRequests';

export const ResidentAccount = () => {
  const { profile, user } = useAuth();
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [supportRefresh, setSupportRefresh] = useState(0);
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
        <div className="flex items-center gap-2 text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="text-[10px] font-bold uppercase tracking-[0.1em]">User Profile</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-text">Account Settings</h1>
        <p className="text-sm text-text-body mt-1">Manage your personal information and contact details.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Form */}
        <div className="lg:col-span-2 bg-white border border-border rounded-lg p-8">
          <h2 className="text-lg font-black tracking-tight text-text mb-6">Personal Details</h2>

          <div className="flex flex-col gap-6">
            <div>
              <label className="block text-xs font-bold text-text-body mb-1.5 uppercase tracking-[0.1em]">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-surface border border-border rounded-md text-sm text-text focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-text-body mb-1.5 uppercase tracking-[0.1em]">Contact Number</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                <input
                  type="tel"
                  value={contactNumber}
                  onChange={handlePhoneChange}
                  maxLength={11}
                  placeholder="09XXXXXXXXX"
                  className="w-full pl-10 pr-4 py-3 bg-surface border border-border rounded-md text-sm text-text placeholder-text-faint focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
                />
              </div>
              <p className="text-[10px] text-text-faint mt-2">This number will be used for SMS notifications if configured by your administrator.</p>
            </div>

            <div className="flex gap-3 mt-2 border-t border-border pt-6">
              <button
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="flex-1 py-3 bg-primary hover:bg-primary-dark text-white shadow-sm text-sm font-bold rounded-lg transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? 'SAVING...' : hasChanges ? 'SAVE CHANGES' : 'NO CHANGES'}
              </button>
            </div>

            {successMsg && (
              <div className="flex items-center gap-2 justify-center text-sm font-bold text-teal-light">
                <CheckCircle2 className="w-4 h-4" /> {successMsg}
              </div>
            )}
            {errorMsg && (
              <div className="flex items-center gap-2 justify-center text-sm font-bold text-primary">
                <AlertTriangle className="w-4 h-4" /> {errorMsg}
              </div>
            )}
          </div>
        </div>

        {/* Account Info Sidebar */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <div className="bg-surface border border-border rounded-lg p-6">
            <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-text-body mb-4">Account Overview</h3>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-primary" />
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint block">Role</span>
                  <span className="text-sm font-bold text-text">Resident / Owner</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Cpu className="w-4 h-4 text-primary" />
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint block">Assigned Unit</span>
                  <span className="text-sm font-bold text-text">{deviceCode || 'None'}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-primary" />
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint block">Registered On</span>
                  <span className="text-sm font-bold text-text">{new Date(profile.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-primary rounded-lg p-6 text-white">
            <Settings className="w-6 h-6 mb-3 text-white/80" />
            <h3 className="font-bold text-lg mb-1">Need Admin Help?</h3>
            <p className="text-xs text-white/80 leading-relaxed mb-4">
              Contact your system administrator to change your role, reset your password, or manage account access.
            </p>
            <button
              onClick={() => setIsSupportModalOpen(true)}
              className="w-full inline-flex justify-center items-center gap-2 px-4 py-2.5 bg-white text-primary text-xs font-bold rounded-md hover:bg-gray-50 transition-colors cursor-pointer"
            >
              <Mail className="w-4 h-4" />
              Contact Administrator
            </button>
          </div>

          <MySupportRequests userId={profile.id} refreshKey={supportRefresh} />
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