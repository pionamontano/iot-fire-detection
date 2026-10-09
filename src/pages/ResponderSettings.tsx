import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { StationSettings } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ProfileSkeleton } from '../components/SkeletonLoaders';
import { Settings, Save, CheckCircle2, User, Phone, Shield, Calendar, AlertTriangle, Building2, MapPin, Mail, Plus, Trash2 } from 'lucide-react';

export const ResponderSettings = () => {
  const { profile } = useAuth();
  const [fullName, setFullName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [profileContactError, setProfileContactError] = useState('');

  const [origName, setOrigName] = useState('');
  const [origContact, setOrigContact] = useState('');

  // Station Settings State
  const [stationLoading, setStationLoading] = useState(true);
  const [stationSaving, setStationSaving] = useState(false);
  const [stationSuccess, setStationSuccess] = useState('');
  const [stationError, setStationError] = useState('');
  const [stationContactError, setStationContactError] = useState('');
  const [personnelContactErrors, setPersonnelContactErrors] = useState<Record<number, string>>({});
  
  const [stationName, setStationName] = useState('');
  const [address, setAddress] = useState('');
  const [stationContact, setStationContact] = useState('');
  const [email, setEmail] = useState('');
  const [keyPersonnel, setKeyPersonnel] = useState<{title: string, name: string, contact: string}[]>([]);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setContactNumber(profile.contact_number || '');
      setOrigName(profile.full_name || '');
      setOrigContact(profile.contact_number || '');
    }
    fetchStationSettings();
  }, [profile]);

  const fetchStationSettings = async () => {
    try {
      const { data, error } = await supabase.from('station_settings').select('*').eq('id', 1).single();
      if (data) {
        setStationName(data.station_name);
        setAddress(data.address);
        setStationContact(data.contact_number);
        setEmail(data.email);
        setKeyPersonnel(data.key_personnel || []);
      }
    } catch (e) {
      console.error('Error fetching station settings:', e);
    } finally {
      setStationLoading(false);
    }
  };

  useEffect(() => {
    setHasChanges(fullName !== origName || contactNumber !== origContact);
  }, [fullName, contactNumber, origName, origContact]);

  const handleSaveProfile = async () => {
    if (!profile) return;
    
    // Validate contact number format if provided
    const phoneRegex = /^(09\d{9})$/;
    if (contactNumber && !phoneRegex.test(contactNumber)) {
      setProfileContactError('Enter a valid Philippine mobile number (e.g. 09171234567).');
      return;
    }
    setProfileContactError('');
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
      setSuccessMsg('Profile updated successfully!');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (e: any) {
      console.error(e);
      setErrorMsg('Failed to save: ' + (e.message || 'Unknown error'));
      setTimeout(() => setErrorMsg(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStation = async () => {
    const phoneRegex = /^(09\d{9})$/;
    
    // Validate station contact
    if (stationContact && !phoneRegex.test(stationContact)) {
      setStationContactError('Enter a valid Philippine mobile number (e.g. 09171234567).');
      return;
    }
    setStationContactError('');
    
    // Validate personnel contacts
    const pErrors: Record<number, string> = {};
    keyPersonnel.forEach((person, index) => {
      if (person.contact && !phoneRegex.test(person.contact)) {
        pErrors[index] = 'Invalid format (e.g. 09171234567)';
      }
    });
    if (Object.keys(pErrors).length > 0) {
      setPersonnelContactErrors(pErrors);
      return;
    }
    setPersonnelContactErrors({});
    
    setStationSaving(true);
    setStationSuccess('');
    setStationError('');
    try {
      const { error } = await supabase
        .from('station_settings')
        .update({
          station_name: stationName.trim(),
          address: address.trim(),
          contact_number: stationContact.trim(),
          email: email.trim(),
          key_personnel: keyPersonnel
        })
        .eq('id', 1);

      if (error) throw error;

      setStationSuccess('Station information updated successfully!');
      setTimeout(() => setStationSuccess(''), 4000);
    } catch (e: any) {
      console.error(e);
      setStationError('Failed to update station info: ' + (e.message || 'Unknown error'));
      setTimeout(() => setStationError(''), 5000);
    } finally {
      setStationSaving(false);
    }
  };

  const addPersonnel = () => {
    setKeyPersonnel([...keyPersonnel, { title: '', name: '', contact: '' }]);
  };

  const removePersonnel = (index: number) => {
    const updated = [...keyPersonnel];
    updated.splice(index, 1);
    setKeyPersonnel(updated);
  };

  const updatePersonnel = (index: number, field: 'title' | 'name' | 'contact', value: string) => {
    const updated = [...keyPersonnel];
    if (field === 'contact') {
      updated[index][field] = value.replace(/\D/g, '');
      if (personnelContactErrors[index]) {
        const newErrors = { ...personnelContactErrors };
        delete newErrors[index];
        setPersonnelContactErrors(newErrors);
      }
    } else {
      updated[index][field] = value;
    }
    setKeyPersonnel(updated);
  };

  if (!profile) return <ProfileSkeleton />;

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="text-[10px] font-bold uppercase tracking-[0.1em]">Account Management</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-text-heading">Settings</h1>
        <p className="text-sm text-text-muted mt-1">Manage your profile and station information.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Profile Form */}
          <div className="bg-surface-card border border-border rounded-lg p-8">
            <h2 className="text-lg font-black tracking-tight text-text-heading mb-6">Personal Profile</h2>

            <div className="flex flex-col gap-6">
              <div>
                <label className="block text-xs font-bold text-text-body mb-1.5 uppercase tracking-[0.1em]">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-surface-alt border border-border rounded-md text-sm text-text focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-text-body mb-1.5 uppercase tracking-[0.1em]">Contact Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                  <input
                    type="tel"
                    maxLength={11}
                    value={contactNumber}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '');
                      setContactNumber(val);
                      if (profileContactError) setProfileContactError('');
                    }}
                    placeholder="09XXXXXXXXX"
                    className={`w-full pl-10 pr-4 py-3 bg-surface-alt border rounded-md text-sm text-text placeholder-text-faint focus:ring-1 transition-all ${profileContactError ? 'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/30' : 'border-border focus:border-primary focus:ring-primary/30'}`}
                  />
                </div>
                <span className="text-[10px] text-text-faint mt-1 block">Philippine number only — e.g. 09171234567</span>
                {profileContactError && <span className="text-[#DC2626] text-[11px] font-bold mt-1 block">{profileContactError}</span>}
              </div>

              <div className="flex gap-3 mt-2">
                <button
                  onClick={handleSaveProfile}
                  disabled={saving || !hasChanges}
                  className="w-full sm:w-auto px-8 py-3 bg-gradient-to-b from-[#B91C1C] to-[#991B1B] text-white text-sm font-bold rounded-lg hover:from-[#DC2626] hover:to-[#B91C1C] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'SAVING...' : 'SAVE PROFILE'}
                </button>
              </div>

              {successMsg && (
                <div className="flex items-center gap-2 text-sm font-bold text-success-dark">
                  <CheckCircle2 className="w-4 h-4" /> {successMsg}
                </div>
              )}

          {/* Telegram Linking */}
          <div className="bg-white border border-[#E4E4E7] rounded-xl overflow-hidden shadow-sm mt-6">
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
                Receive Tier 2 (Critical) dispatch alerts directly to your Telegram app. Telegram alerts include full technical context and GPS coordinates.
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
                <div className="flex items-center gap-2 text-sm font-bold text-[#DC2626]">
                  <AlertTriangle className="w-4 h-4" /> {errorMsg}
                </div>
              )}
            </div>
          </div>

          {/* Station Info Form */}
          <div className="bg-surface-card border border-border rounded-lg p-8">
            <h2 className="text-lg font-black tracking-tight text-text-heading mb-6">Station Information</h2>
            
            {stationLoading ? (
              <p className="text-text-faint text-sm">Loading station settings...</p>
            ) : (
              <div className="flex flex-col gap-6">
                <div>
                  <label className="block text-xs font-bold text-text-body mb-1.5 uppercase tracking-[0.1em]">Station Name</label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                    <input
                      type="text"
                      value={stationName}
                      onChange={e => setStationName(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-surface-alt border border-border rounded-md text-sm text-text focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-body mb-1.5 uppercase tracking-[0.1em]">Address</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                    <input
                      type="text"
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-surface-alt border border-border rounded-md text-sm text-text focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-text-body mb-1.5 uppercase tracking-[0.1em]">Contact Number</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                      <input
                        type="tel"
                        maxLength={11}
                        value={stationContact}
                        onChange={e => {
                          const val = e.target.value.replace(/\D/g, '');
                          setStationContact(val);
                          if (stationContactError) setStationContactError('');
                        }}
                        placeholder="09XXXXXXXXX"
                        className={`w-full pl-10 pr-4 py-3 bg-surface-alt border rounded-md text-sm text-text focus:ring-1 transition-all ${stationContactError ? 'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/30' : 'border-border focus:border-primary focus:ring-primary/30'}`}
                      />
                    </div>
                    <span className="text-[10px] text-text-faint mt-1 block">Philippine number only — e.g. 09171234567</span>
                    {stationContactError && <span className="text-[#DC2626] text-[11px] font-bold mt-1 block">{stationContactError}</span>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-body mb-1.5 uppercase tracking-[0.1em]">Email</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-surface-alt border border-border rounded-md text-sm text-text focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-border mt-2">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-text-heading">Key Personnel</h3>
                    <button 
                      onClick={addPersonnel}
                      className="text-xs font-bold text-[#B91C1C] flex items-center gap-1 hover:text-[#DC2626]"
                    >
                      <Plus className="w-3.5 h-3.5" /> ADD PERSONNEL
                    </button>
                  </div>
                  
                  <div className="flex flex-col gap-3">
                    {keyPersonnel.map((person, index) => (
                      <div key={index} className="flex flex-col sm:flex-row gap-3 bg-surface-alt p-3 rounded-lg border border-border items-start sm:items-center">
                        <div className="flex-1 w-full sm:w-auto">
                          <input
                            type="text"
                            placeholder="Title / Position (e.g. Fire Chief)"
                            value={person.title}
                            onChange={e => updatePersonnel(index, 'title', e.target.value)}
                            className="w-full bg-white border border-border rounded px-3 py-2 text-xs focus:border-primary focus:outline-none"
                          />
                        </div>
                        <div className="flex-1 w-full sm:w-auto">
                          <input
                            type="text"
                            placeholder="Full Name"
                            value={person.name}
                            onChange={e => updatePersonnel(index, 'name', e.target.value)}
                            className="w-full bg-white border border-border rounded px-3 py-2 text-xs focus:border-primary focus:outline-none"
                          />
                        </div>
                        <div className="flex-1 w-full sm:w-auto">
                          <input
                            type="tel"
                            maxLength={11}
                            placeholder="09XXXXXXXXX"
                            value={person.contact}
                            onChange={e => updatePersonnel(index, 'contact', e.target.value)}
                            className={`w-full bg-white border rounded px-3 py-2 text-xs focus:outline-none ${personnelContactErrors[index] ? 'border-[#DC2626] focus:border-[#DC2626]' : 'border-border focus:border-primary'}`}
                          />
                          {personnelContactErrors[index] && <span className="text-[#DC2626] text-[10px] font-bold mt-0.5 block">{personnelContactErrors[index]}</span>}
                        </div>
                        <button 
                          onClick={() => removePersonnel(index)}
                          className="p-2 text-text-faint hover:text-[#DC2626] transition-colors self-end sm:self-auto"
                          title="Remove"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {keyPersonnel.length === 0 && (
                      <p className="text-xs text-text-faint text-center py-4 bg-surface-alt rounded border border-dashed border-border">
                        No key personnel added. Click the add button to start.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleSaveStation}
                    disabled={stationSaving}
                    className="w-full sm:w-auto px-8 py-3 bg-[#1C1B1B] text-white text-sm font-bold rounded-lg hover:bg-black transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    {stationSaving ? 'SAVING...' : 'SAVE STATION INFO'}
                  </button>
                </div>

                {stationSuccess && (
                  <div className="flex items-center gap-2 text-sm font-bold text-success-dark">
                    <CheckCircle2 className="w-4 h-4" /> {stationSuccess}
                  </div>
                )}
                {stationError && (
                  <div className="flex items-center gap-2 text-sm font-bold text-[#DC2626]">
                    <AlertTriangle className="w-4 h-4" /> {stationError}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Account Info Sidebar */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <div className="bg-surface-alt border border-border rounded-lg p-6">
            <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-text-body mb-4">Account Details</h3>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-[#B91C1C]" />
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint block">Role</span>
                  <span className="text-sm font-bold text-text-heading">BFP Responder</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-[#B91C1C]" />
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint block">User ID</span>
                  <span className="text-xs font-mono text-text-body">{profile.id.substring(0, 16)}...</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-[#B91C1C]" />
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint block">Joined</span>
                  <span className="text-sm font-bold text-text-heading">{new Date(profile.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#B91C1C] rounded-lg p-6 text-white">
            <Settings className="w-6 h-6 mb-3 text-white/80" />
            <h3 className="font-bold text-lg mb-1">Need Admin Help?</h3>
            <p className="text-xs text-white/80 leading-relaxed">
              Contact your system administrator to change your role, reset your password, or manage account access.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
