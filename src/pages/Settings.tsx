import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Save, Clock, ShieldCheck, Activity, UserCheck, BellRing, Settings as SettingsIcon, Unlock } from 'lucide-react';
import { SettingsFormSkeleton } from '../components/SkeletonLoaders';

export const Settings = () => {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Manual unlock for a login-rate-limit lockout (spec SW-2.6.2's
  // "requiring Administrator intervention") — the lockout itself is
  // otherwise purely time-window based and only expires on its own.
  const [unlockEmail, setUnlockEmail] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockMessage, setUnlockMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('settings').select('*');
    if (!error && data) {
      const settingsMap: Record<string, string> = {};
      data.forEach(s => {
        settingsMap[s.key] = s.value;
      });
      setSettings(settingsMap);
    }
    setLoading(false);
  };

  const handleChange = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleUnlock = async () => {
    const email = unlockEmail.trim();
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
    setSaving(true);
    const updates = Object.keys(settings).map(key => ({
      key,
      value: settings[key],
    }));

    const { error } = await supabase.from('settings').upsert(updates);
    
    if (error) {
      alert('Failed to save settings: ' + error.message);
    } else {
      alert('Settings saved successfully!');
    }
    setSaving(false);
  };

  return (
    <div className="max-w-4xl space-y-8">
      {/* Page Header */}
      <div>
        <p className="text-primary-dark font-bold text-xs tracking-[0.05em] uppercase mb-1">System Security Configuration</p>
        <h2 className="text-text-heading font-extrabold text-[40px] leading-9 tracking-[-0.019em]">
          System Settings
        </h2>
        <p className="text-text-warm text-base leading-[26px] mt-2 max-w-xl">
          Configure global application parameters and security policies. These parameters define
          the transition between operational telemetry and emergency protocols.
        </p>
      </div>

      {/* Settings Card */}
      <div className="bg-surface-card border border-border rounded-lg overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        {/* Section Header */}
        <div className="px-8 py-5 border-b border-border bg-surface-alt flex items-center gap-3">
          <ShieldCheck className="text-teal w-5 h-5" />
          <h3 className="text-base font-bold text-text-heading">Security & Session Policies</h3>
        </div>
        
        {loading ? (
          <SettingsFormSkeleton />
        ) : (
          <div className="p-8 space-y-8">
            
            {/* Session Timeouts */}
            <div>
              <h4 className="text-xs font-bold text-text-body uppercase tracking-[0.1em] mb-1 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" />
                Inactivity Timeouts (Minutes)
              </h4>
              <p className="text-xs text-text-warm mb-5">Set how long users can be inactive before they are automatically logged out for security purposes.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-xs font-bold text-text-body mb-2 uppercase tracking-[0.1em]">Admin Timeout</label>
                  <input 
                    type="number" min="1" max="1440"
                    value={settings['timeout_admin'] || '15'}
                    onChange={(e) => handleChange('timeout_admin', e.target.value)}
                    className="w-full bg-surface-card border border-border rounded-md px-4 py-2.5 text-sm text-text focus:border-teal focus:ring-1 focus:ring-teal/30 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-text-body mb-2 uppercase tracking-[0.1em]">Responder Timeout</label>
                  <input 
                    type="number" min="1" max="1440"
                    value={settings['timeout_bfp'] || '15'}
                    onChange={(e) => handleChange('timeout_bfp', e.target.value)}
                    className="w-full bg-surface-card border border-border rounded-md px-4 py-2.5 text-sm text-text focus:border-teal focus:ring-1 focus:ring-teal/30 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-text-body mb-2 uppercase tracking-[0.1em]">Resident Timeout</label>
                  <input 
                    type="number" min="1" max="1440"
                    value={settings['timeout_resident'] || '60'}
                    onChange={(e) => handleChange('timeout_resident', e.target.value)}
                    className="w-full bg-surface-card border border-border rounded-md px-4 py-2.5 text-sm text-text focus:border-teal focus:ring-1 focus:ring-teal/30 transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Node Monitoring */}
            <div className="pt-8 border-t border-border">
              <h4 className="text-xs font-bold text-text-body uppercase tracking-[0.1em] mb-1 flex items-center gap-2">
                <Activity className="w-3.5 h-3.5" />
                Node Monitoring
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-5">
                <div>
                  <label className="block text-xs font-bold text-text-body mb-2 uppercase tracking-[0.1em]">Node Offline Threshold (Minutes)</label>
                  <input 
                    type="number" min="1" disabled
                    value="5"
                    className="w-full bg-surface-alt border border-border rounded-md px-4 py-2.5 text-sm text-text-faint cursor-not-allowed"
                  />
                  <p className="text-xs text-text-warm mt-2">Time before a node is marked offline. Managed by Edge Functions.</p>
                </div>
              </div>
            </div>

            {/* Account Lockouts */}
            <div className="pt-8 border-t border-border">
              <h4 className="text-xs font-bold text-text-body uppercase tracking-[0.1em] mb-1 flex items-center gap-2">
                <Unlock className="w-3.5 h-3.5" />
                Account Lockouts
              </h4>
              <p className="text-xs text-text-warm mb-5">
                A locked-out account (7+ failed logins) normally clears itself after 15 minutes.
                Enter the account's email to lift the lockout immediately.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={unlockEmail}
                  onChange={(e) => setUnlockEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                  className="flex-1 w-full sm:w-auto bg-surface-card border border-border rounded-md px-4 py-2.5 text-sm text-text focus:border-teal focus:ring-1 focus:ring-teal/30 transition-all"
                />
                <button
                  onClick={handleUnlock}
                  disabled={unlocking || !unlockEmail.trim()}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-border text-text-body text-sm font-bold hover:bg-surface-alt transition-colors disabled:opacity-50 shrink-0"
                >
                  <Unlock className="w-4 h-4" />
                  {unlocking ? 'Unlocking...' : 'Unlock Account'}
                </button>
              </div>
              {unlockMessage && (
                <p className={`text-xs font-semibold mt-3 ${unlockMessage.startsWith('Failed') ? 'text-[#DC2626]' : 'text-teal'}`}>{unlockMessage}</p>
              )}
            </div>

          </div>
        )}
        
        {/* Save Button */}
        <div className="px-8 py-5 bg-surface-alt border-t border-border flex justify-end">
          <button 
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2 bg-gradient-to-b from-[#FFB3AC] to-accent text-white px-6 py-2.5 rounded font-bold text-sm hover:shadow-[0_4px_6px_-4px_rgba(0,0,0,0.1),0_10px_15px_-3px_rgba(0,0,0,0.1)] transition-all disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : 'Save Settings'}</span>
          </button>
        </div>
      </div>

      {/* Current Configuration Summary */}
      <div className="bg-surface-alt border-l-4 border-primary-dark rounded-lg p-8 space-y-6">
        <h4 className="text-primary-dark font-bold text-xs uppercase tracking-[0.1em]">Current Configuration Summary</h4>
        <div className="space-y-3">
          {[
            { label: 'Admin Session Timeout', value: `${settings['timeout_admin'] || '15'} min` },
            { label: 'Responder Session Timeout', value: `${settings['timeout_bfp'] || '15'} min` },
            { label: 'Resident Session Timeout', value: `${settings['timeout_resident'] || '60'} min` },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between bg-surface-card rounded px-4 py-3 border border-border">
              <span className="text-sm font-semibold text-text-heading">{item.label}</span>
              <span className="text-sm font-bold font-mono text-text-heading">{item.value}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-4 border-t border-border">
          <span className="w-3 h-3 rounded-full bg-teal"></span>
          <span className="text-xs font-bold text-text-heading uppercase tracking-[0.05em]">System Integrity Confirmed</span>
        </div>
      </div>
    </div>
  );
};