import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle, RotateCcw, Mail, Phone, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { SupportRequest, Device, Role } from '../../lib/supabase';
import { DEVICE_COLUMNS } from '../../lib/deviceColumns';
import { ROLE_OPTIONS } from '../../lib/roles';
import { formatDateTime, getRoleLabel, DEVICE_REQUEST_CATEGORY } from '../../lib/supportRequests';
import { OptionList, DevicePicker } from '../../components/pickers';
import type { Option } from '../../components/pickers';
import {
  LABEL, FIELD, BTN_SECONDARY, BTN_PRIMARY, BTN_SUCCESS, PILL, PILL_OFF,
  Identity, ErrorNote, Modal, ModalActions,
} from '../../components/ui';

/** The requester's current account, joined from profiles. */
export type Requester = {
  role: Role;
  device_id: string | null;
  is_active: boolean | null;
  telegram_chat_id: string | null;
};
export type SupportRequestRow = SupportRequest & { requester: Requester | null };

type ActionId = 'none' | 'role' | 'reset_link' | 'temp_password' | 'unlock' | 'device';

const EMPTY = '—';

// Categories from supportCategoriesFor() (both roles' lists, plus ones older requests may carry); anything else falls back to grey.
const CATEGORY_BADGE: Record<string, string> = {
  'Role Change': 'bg-blue-100 text-blue-800 border-blue-200',
  'Password Reset': 'bg-purple-100 text-purple-800 border-purple-200',
  'Station Assignment': 'bg-green-100 text-green-800 border-green-200',
  [DEVICE_REQUEST_CATEGORY]: 'bg-green-100 text-green-800 border-green-200',
  'Account Access / Permissions': 'bg-amber-100 text-amber-800 border-amber-200',
};

export const CategoryBadge = ({ category }: { category: string }) => (
  <span className={`${PILL} font-semibold ${CATEGORY_BADGE[category] ?? 'bg-gray-100 text-gray-800 border-gray-200'}`}>
    {category}
  </span>
);

export const ContactLines = ({ req }: { req: SupportRequest }) => {
  if (!req.contact_email && !req.contact_phone) return <span className="text-text-warm">{EMPTY}</span>;
  return (
    <div className="space-y-1 text-text-body">
      {req.contact_email && (
        <a href={`mailto:${req.contact_email}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 hover:text-primary break-all">
          <Mail className="w-3.5 h-3.5 shrink-0 text-text-faint" />{req.contact_email}
        </a>
      )}
      {req.contact_phone && (
        <a href={`tel:${req.contact_phone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 hover:text-primary">
          <Phone className="w-3.5 h-3.5 shrink-0 text-text-faint" />{req.contact_phone}
        </a>
      )}
    </div>
  );
};

const DT = 'text-text-body font-black text-[10px] uppercase tracking-[0.1em] mb-1';

// supabase-js only reports "non-2xx status code"; the function's own message is in the body.
async function invoke(name: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let detail = '';
    try { detail = (await error.context?.json())?.error ?? ''; } catch { /* not JSON */ }
    throw new Error(detail || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

const defaultAction = (req: SupportRequestRow): ActionId => {
  switch (req.category) {
    case 'Role Change': return 'role';
    case 'Password Reset': return req.contact_email ? 'reset_link' : 'temp_password';
    case 'Account Access / Permissions': return req.contact_email ? 'unlock' : 'none';
    case DEVICE_REQUEST_CATEGORY: return 'device';
    // Residents used to pick this to ask for a device; keep those older requests working.
    case 'Station Assignment': return req.requester?.role === 'resident' ? 'device' : 'none';
    default: return 'none';
  }
};

const randomPassword = () => {
  // No look-alike characters, so it can be read out over the phone.
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
};

export const SupportRequestDialog = ({ request, reviewerName, onClose, onDone }: {
  request: SupportRequestRow;
  reviewerName?: string;
  onClose: () => void;
  // Called after a successful resolve/reopen, with a one-line outcome for the page.
  onDone: (message: string) => void;
}) => {
  const requester = request.requester;
  const isOpen = request.status === 'open';

  const [action, setAction] = useState<ActionId>(() => defaultAction(request));
  const [role, setRole] = useState<string>(() =>
    ROLE_OPTIONS.find(o => o.value !== requester?.role)?.value ?? 'resident');
  const [password, setPassword] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [notes, setNotes] = useState(request.admin_notes ?? '');
  // The note follows the chosen action until the admin types their own.
  const [notesEdited, setNotesEdited] = useState(!!request.admin_notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actions: Option[] = [
    { value: 'none', title: 'No account change', detail: 'Just reply and mark it resolved' },
    {
      value: 'role',
      title: 'Change role',
      detail: requester ? `Currently ${getRoleLabel(requester.role)}` : undefined,
    },
    ...(request.contact_email ? [
      { value: 'reset_link', title: 'Email a password reset link', detail: `They choose a new password from the link sent to ${request.contact_email}` },
    ] : []),
    { value: 'temp_password', title: 'Set a temporary password', detail: 'You give it to them yourself, e.g. by phone' },
    ...(request.contact_email ? [
      { value: 'unlock', title: 'Unlock sign-in', detail: 'Lifts a lockout after too many failed logins' },
    ] : []),
    ...(requester?.role === 'resident' ? [
      { value: 'device', title: requester.device_id ? 'Reassign device' : 'Assign a device', detail: 'Links one of the unassigned devices to this resident' },
    ] : []),
  ];

  const roleLabel = getRoleLabel(role);
  const deviceCode = devices?.find(d => d.id === deviceId)?.device_code;
  const suggestedNote: Record<ActionId, string> = {
    none: '',
    role: `Your role has been changed to ${roleLabel}. Sign out and back in to see your new dashboard.`,
    reset_link: 'We sent a password reset link to your email. Open it to choose a new password.',
    temp_password: 'Your password was reset to a temporary one, which the administrator will give you directly. Please change it after signing in.',
    unlock: 'Your sign-in lockout has been lifted. You can sign in again now.',
    device: deviceCode ? `Device ${deviceCode} has been assigned to your account.` : 'A device has been assigned to your account.',
  };

  useEffect(() => {
    if (!notesEdited) setNotes(suggestedNote[action]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, role, deviceCode, notesEdited]);

  useEffect(() => {
    if (action === 'temp_password' && !password) setPassword(randomPassword());
    if (action === 'device' && devices === null) loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  const loadDevices = async () => {
    const [{ data: all, error: devErr }, { data: owners }] = await Promise.all([
      supabase.from('devices').select<string, Device>(DEVICE_COLUMNS),
      supabase.from('profiles').select('device_id').not('device_id', 'is', null),
    ]);
    if (devErr) { setError(`Couldn't load devices: ${devErr.message}`); setDevices([]); return; }
    const taken = new Set((owners || []).map(o => o.device_id));
    setDevices((all || []).filter(d => !taken.has(d.id)));
  };

  const actionReady =
    action === 'none' || action === 'reset_link' || action === 'unlock'
    || (action === 'role' && role !== requester?.role)
    || (action === 'temp_password' && password.length >= 6)
    || (action === 'device' && !!deviceId);

  // Runs the chosen account change. Throws with a readable message on failure.
  const applyAction = async () => {
    switch (action) {
      case 'role':
        return invoke('manage-user', { action: 'update', user_id: request.user_id, role });
      case 'temp_password':
        return invoke('manage-user', { action: 'update', user_id: request.user_id, password });
      case 'device':
        return invoke('assign-device', { profile_id: request.user_id, device_id: deviceId });
      case 'unlock': {
        const { error: e } = await supabase.rpc('admin_unlock_login', { p_email: request.contact_email!.trim().toLowerCase() });
        if (e) throw new Error(e.message);
        return;
      }
      case 'reset_link': {
        const { error: e } = await supabase.auth.resetPasswordForEmail(request.contact_email!, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (e) throw new Error(e.message);
        return;
      }
    }
  };

  const notifiedText = (n?: { telegram?: string; push?: string }) => {
    const via = [n?.telegram === 'sent' && 'Telegram', n?.push === 'sent' && 'push'].filter(Boolean);
    return via.length
      ? `They were notified by ${via.join(' and ')}.`
      : 'They have no Telegram or push set up, so they will see it in their account.';
  };

  const handleResolve = async () => {
    setSaving(true);
    setError(null);
    try {
      await applyAction();
    } catch (e) {
      setError(`Couldn't apply the account change: ${(e as Error).message}`);
      setSaving(false);
      return;
    }
    // The account change is done; never repeat it on a retry of the resolve step.
    setAction('none');
    setNotesEdited(true);
    try {
      const data = await invoke('resolve-support-request', { request_id: request.id, status: 'resolved', admin_notes: notes });
      onDone(`Resolved ${request.full_name}'s request. ${notifiedText(data?.notified)}`);
    } catch (e) {
      setError(`${action === 'none' ? '' : 'The account change was applied, but '}the request couldn't be marked resolved: ${(e as Error).message}`);
      setSaving(false);
    }
  };

  const handleReopen = async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke('resolve-support-request', { request_id: request.id, status: 'open' });
      onDone(`Reopened ${request.full_name}'s request.`);
    } catch (e) {
      setError(`Couldn't reopen this request: ${(e as Error).message}`);
      setSaving(false);
    }
  };

  const close = () => { if (!saving) onClose(); };

  return (
    <Modal title={isOpen ? 'Resolve Request' : 'Support Request'} onClose={close}>
      {error && <ErrorNote message={error} />}

      <Identity
        name={request.full_name}
        sub={requester ? `Now ${getRoleLabel(requester.role)}` : getRoleLabel(request.role_at_request)}
        badge={requester?.is_active === false && <span className={PILL_OFF}>Deactivated</span>}
      />

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className={DT}>Category</dt>
          <dd><CategoryBadge category={request.category} /></dd>
        </div>
        <div>
          <dt className={DT}>Submitted</dt>
          <dd className="text-text-warm">{formatDateTime(request.created_at)}</dd>
        </div>
        <div className="col-span-2">
          <dt className={DT}>Contact</dt>
          <dd><ContactLines req={request} /></dd>
        </div>
      </dl>

      <p className={`${LABEL} mt-5`}>Message</p>
      <div className="bg-surface border border-border rounded-lg p-3 text-sm text-text whitespace-pre-line break-words">
        {request.message}
      </div>

      {isOpen ? (
        <>
          {requester ? (
            <>
              <p className={`${LABEL} mt-5`}>Account change</p>
              <OptionList name="support-action" label="Account change" value={action} onChange={(v) => setAction(v as ActionId)} options={actions} />

              {action === 'role' && (
                <div className="mt-3 pl-3 border-l-2 border-border">
                  <p className="text-xs font-bold text-text-body mb-2">New role</p>
                  <OptionList
                    name="support-role"
                    label="New role"
                    value={role}
                    onChange={setRole}
                    options={ROLE_OPTIONS.map(o => o.value === requester.role ? { ...o, detail: 'Current role' } : o)}
                  />
                  {requester.role === 'resident' && requester.device_id && role !== 'resident' && (
                    <p className="text-xs text-amber mt-2">Their device will be unassigned, since only residents own devices.</p>
                  )}
                </div>
              )}

              {action === 'temp_password' && (
                <div className="mt-3 pl-3 border-l-2 border-border">
                  <label htmlFor="temp-password" className="block text-xs font-bold text-text-body mb-2">Temporary password</label>
                  <div className="flex gap-2">
                    <input
                      id="temp-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${FIELD} font-mono`}
                      autoComplete="off"
                    />
                    <button type="button" onClick={() => setPassword(randomPassword())} className={`${BTN_SECONDARY} shrink-0`}>New</button>
                  </div>
                  <p className={`text-xs mt-2 ${password.length >= 6 ? 'text-text-warm' : 'text-tier2-border font-semibold'}`}>
                    {password.length >= 6
                      ? 'Copy it before resolving. It is not shown again and is not included in the note.'
                      : 'At least 6 characters.'}
                  </p>
                </div>
              )}

              {action === 'device' && (
                <div className="mt-3 pl-3 border-l-2 border-border">
                  <p className="text-xs font-bold text-text-body mb-2">Choose an unassigned device</p>
                  {devices === null
                    ? <Loader2 className="w-5 h-5 text-primary animate-spin" />
                    : <DevicePicker name="support-device" value={deviceId} onChange={setDeviceId} devices={devices} />}
                </div>
              )}
            </>
          ) : (
            <p className="mt-5 text-xs text-text-warm">This account no longer exists, so only a note can be saved.</p>
          )}

          <label htmlFor="resolution-notes" className={`${LABEL} mt-5`}>
            Reply to {request.full_name.split(' ')[0]} <span className="font-medium text-text-warm">(optional)</span>
          </label>
          <textarea
            id="resolution-notes"
            value={notes}
            onChange={(e) => { setNotes(e.target.value); setNotesEdited(true); }}
            maxLength={1000}
            placeholder="e.g. Done, you can sign in again now"
            className={`${FIELD} h-24 py-2 resize-none`}
          />
          <p className="text-xs text-text-warm mt-1.5 flex items-center gap-1.5">
            <Send className="w-3 h-3 shrink-0" />
            Shown in their account{requester?.telegram_chat_id ? ' and sent on Telegram' : ''}, plus a push notification if enabled.
          </p>

          <ModalActions>
            <button onClick={close} disabled={saving} className={BTN_SECONDARY}>Cancel</button>
            <button onClick={handleResolve} disabled={saving || (!!requester && !actionReady)} className={BTN_SUCCESS}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {action === 'none' || !requester ? 'Mark Resolved' : 'Apply & Resolve'}
            </button>
          </ModalActions>
        </>
      ) : (
        <>
          <p className={`${LABEL} mt-5`}>Resolution</p>
          <p className="text-sm text-text-warm">
            {formatDateTime(request.reviewed_at)}
            {reviewerName && <> by {reviewerName}</>}
          </p>
          <p className="text-sm text-text mt-1 whitespace-pre-line">
            {request.admin_notes || <span className="text-text-warm italic">No notes</span>}
          </p>
          <ModalActions>
            <button onClick={handleReopen} disabled={saving} className={BTN_SECONDARY}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Reopen
            </button>
            <button onClick={close} disabled={saving} className={BTN_PRIMARY}>Done</button>
          </ModalActions>
        </>
      )}
    </Modal>
  );
};
