import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Save, User, Phone, Shield, Calendar, Cpu, Mail } from 'lucide-react';
import { ProfileSkeleton } from '../../components/SkeletonLoaders';
import { AdminSupportModal } from '../../components/AdminSupportModal';
import { MySupportRequests } from '../../components/MySupportRequests';
import { PageHeader } from '../../components/PageHeader';
import { BTN_PRIMARY, FIELD, LABEL } from '../../components/ui';
import { getRoleLabel } from '../../lib/supportRequests';

export const ResidentAccount = () => {
  const { profile, user } = useAuth();
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [supportRefresh, setSupportRefresh] = useState(0);
  const [fullName, setFullName] = useState('');
  const [origName, setOrigName] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deviceCode, setDeviceCode] = useState('');

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setOrigName(profile.full_name || '');
      if (profile.device_id) fetchDevice(profile.device_id);
    }
  }, [profile]);

  const fetchDevice = async (id: string) => {
    const { data } = await supabase.from('devices_safe').select('device_code').eq('id', id).single();
    if (data) setDeviceCode(data.device_code);
  };

  const nameChanged = fullName.trim() !== origName;

  const handleSave = async () => {
    if (!profile) return;
    if (!fullName.trim()) {
      setMsg({ ok: false, text: 'Name cannot be empty.' });
      return;
    }
    setSaving(true);
    setMsg(null);
    const { error } = await supabase.from('profiles').update({ full_name: fullName.trim() }).eq('id', profile.id);
    if (error) {
      console.error(error);
      setMsg({ ok: false, text: `Couldn't save: ${error.message}` });
    } else {
      setOrigName(fullName.trim());
      setMsg({ ok: true, text: 'Saved.' });
    }
    setSaving(false);
  };

  if (!profile) return <ProfileSkeleton />;

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader title="Account Settings" description="Your personal details, and help from an administrator." />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Profile */}
        <section className="lg:col-span-2 bg-white border border-border rounded-lg p-5 sm:p-6 min-w-0">
          <h2 className="text-lg font-bold tracking-[-0.01em] text-text">Personal Details</h2>

          <div className="flex flex-col gap-6 mt-6">
            <div>
              <label htmlFor="full-name" className={LABEL}>Full name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                <input
                  id="full-name"
                  type="text"
                  value={fullName}
                  onChange={e => { setFullName(e.target.value); setMsg(null); }}
                  className={`${FIELD} pl-10`}
                />
              </div>
            </div>

            {/* One place to edit the SMS number: Alert Settings, next to the other alert channels. */}
            <div>
              <span className={LABEL}>Mobile number</span>
              <div className="flex items-center justify-between gap-3 h-10 px-3 border border-border rounded-lg bg-surface-alt">
                <span className="inline-flex items-center gap-2 text-sm text-text min-w-0">
                  <Phone className="w-4 h-4 text-text-faint shrink-0" />
                  <span className="truncate">{profile.contact_number || 'Not set'}</span>
                </span>
                <Link to="/home/settings" className="text-primary-dark font-bold text-xs hover:underline shrink-0">Change</Link>
              </div>
              <p className="text-xs text-text-subtle mt-2">Fire alert SMS go to this number. Change it in Alert Settings.</p>
            </div>

            <div>
              <span className={LABEL}>Email</span>
              <div className="flex items-center gap-2 h-10 px-3 border border-border rounded-lg bg-surface-alt text-sm text-text">
                <Mail className="w-4 h-4 text-text-faint shrink-0" />
                <span className="truncate">{user?.email || 'Not available'}</span>
              </div>
              <p className="text-xs text-text-subtle mt-2">Used to sign in. Ask an administrator to change it.</p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-t border-border-warm pt-5">
              <button type="button" onClick={handleSave} disabled={saving || !nameChanged} className={BTN_PRIMARY}>
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save changes'}
              </button>
              {msg && (
                <p role={msg.ok ? 'status' : 'alert'} className={`text-xs font-semibold ${msg.ok ? 'text-success-dark' : 'text-primary'}`}>{msg.text}</p>
              )}
            </div>
          </div>
        </section>

        {/* Side column */}
        <div className="lg:col-span-1 flex flex-col gap-6 min-w-0">
          <section className="bg-white border border-border rounded-lg p-5 sm:p-6">
            <h2 className="text-lg font-bold tracking-[-0.01em] text-text">Account</h2>
            <dl className="flex flex-col gap-4 mt-5">
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-text-body shrink-0" />
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-body">Role</dt>
                  <dd className="text-sm font-bold text-text">{getRoleLabel(profile.role)}</dd>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Cpu className="w-4 h-4 text-text-body shrink-0" />
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-body">Device</dt>
                  <dd className="text-sm font-bold text-text">
                    {deviceCode ? <Link to="/home/devices" className="hover:underline">{deviceCode}</Link> : 'None linked'}
                  </dd>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-text-body shrink-0" />
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-body">Member since</dt>
                  <dd className="text-sm font-bold text-text">{new Date(profile.created_at).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}</dd>
                </div>
              </div>
            </dl>
          </section>

          <section className="bg-white border border-border rounded-lg p-5 sm:p-6">
            <h2 className="text-lg font-bold tracking-[-0.01em] text-text">Need Help?</h2>
            <p className="text-xs text-text-subtle leading-relaxed mt-1">
              Ask an administrator to link or change your device, reset your password, or fix account access.
            </p>
            <button type="button" onClick={() => setIsSupportModalOpen(true)} className={`${BTN_PRIMARY} w-full mt-4`}>
              <Mail className="w-4 h-4" />
              Contact administrator
            </button>
          </section>

          <MySupportRequests
            userId={profile.id}
            refreshKey={supportRefresh}
            cardClassName="bg-white border border-border rounded-lg p-5 sm:p-6"
            titleClassName="text-lg font-bold tracking-[-0.01em] text-text"
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