import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '../../components/PageHeader';
import { supabase } from '../../lib/supabase';
import { DEVICE_COLUMNS } from '../../lib/deviceColumns';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import type { Profile, RegistrationRequest, Device } from '../../lib/supabase';
import {
  UserPlus, Cpu,
  Loader2, Link, CheckCircle, Users as UsersIcon, UserX, Pencil,
  Search, X, AlertCircle, ShieldAlert
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { TABLE_CARD, TABLE, THEAD_ROW, TH, TR, TD } from '../../components/Table';

// One placeholder for every missing value on this page.
const EMPTY = '—';
const Empty = () => <span className="text-text-warm">{EMPTY}</span>;

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return EMPTY;
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

// manage-registration stores this literal when an admin rejects without
// typing a reason, so it is not a real reason to show.
const DEFAULT_REJECT_NOTE = 'Rejected';

// ─── Shared styles (theme tokens from index.css, same as Dashboard) ───

const LABEL = 'block text-sm font-bold text-text mb-1';
const FIELD = 'w-full h-10 px-3 border border-border rounded-lg bg-surface-card text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary';
const BTN = 'h-10 px-4 rounded-lg font-bold text-sm transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50';
const BTN_SECONDARY = `${BTN} border border-border text-text-body bg-surface-card hover:bg-surface`;
const BTN_PRIMARY = `${BTN} bg-primary text-white hover:bg-primary-dark shadow-sm`;
const BTN_SUCCESS = `${BTN} bg-success-dark text-white hover:bg-[#065F46] shadow-sm`;
// Row-level actions: compact pills on desktop, full-width tap targets on cards.
const ACTION = 'h-9 px-3 rounded-lg font-bold text-sm transition-colors inline-flex items-center justify-center gap-1.5 flex-1 2xl:flex-none';
const ACTION_APPROVE = `${ACTION} bg-success/10 text-success-dark hover:bg-success/20`;
const ACTION_REJECT = `${ACTION} bg-tier2-bg text-primary hover:bg-tier2-bg/70`;
const ACTION_EDIT = `${ACTION} border border-border text-text-body bg-surface-card hover:bg-surface hover:text-text`;

// No nowrap here: table cells already keep one line, card fields may need to wrap.
const PILL = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold max-w-full';
const PILL_OK = `${PILL} bg-success/10 text-success-dark border-success/30`;
const PILL_WARN = `${PILL} bg-tier1-bg text-tier1-text border-amber-light/40`;
const PILL_OFF = `${PILL} bg-surface-alt text-text-muted border-border`;

type TabType = 'approved' | 'pending' | 'rejected';
type AccountInfo = { email: string | null; last_sign_in_at: string | null };
const EMPTY_EDIT_FORM = { fullName: '', email: '', contactNumber: '', address: '', role: 'resident' as Profile['role'], password: '' };
type RoleFilter = 'all' | Profile['role'];

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-800 border-purple-200',
  bfp_responder: 'bg-blue-100 text-blue-800 border-blue-200',
  resident: 'bg-green-100 text-green-800 border-green-200',
};

const getRoleLabel = (role: string) => {
  switch (role) {
    case 'admin': return 'Administrator';
    case 'bfp_responder': return 'BFP Responder';
    case 'resident': return 'Resident / Owner';
    default: return role;
  }
};

const ROLE_OPTIONS: Option[] = [
  { value: 'resident', title: 'Resident / Owner', detail: 'Owns a device and gets home alerts' },
  { value: 'bfp_responder', title: 'BFP Responder', detail: 'Receives and responds to fire alerts' },
  { value: 'admin', title: 'Administrator', detail: 'Full access to this dashboard' },
];

const RoleBadge = ({ role }: { role: string }) => (
  <span className={`${PILL} font-semibold ${ROLE_BADGE[role] ?? 'bg-gray-100 text-gray-800 border-gray-200'}`}>
    {getRoleLabel(role)}
  </span>
);

const Avatar = ({ name }: { name: string }) => (
  <div className="w-10 h-10 shrink-0 rounded-full bg-surface border border-border flex items-center justify-center font-bold text-text-body">
    {name.charAt(0).toUpperCase()}
  </div>
);

// Single-select filter chips (replaces a <select>): every option and its
// count is visible at once, and one tap switches. Scrolls sideways on phones.
function FilterChips<V extends string>({ label, value, onChange, options }: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string; count: number }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2 overflow-x-auto scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0">
      {options.map(o => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={`h-9 px-3.5 rounded-full border text-sm whitespace-nowrap shrink-0 inline-flex items-center gap-2 transition-colors ${
              selected
                ? 'bg-primary border-primary text-white font-bold'
                : 'bg-surface-card border-border text-text-body font-semibold hover:border-text-faint hover:text-text'
            }`}
          >
            {o.label}
            <span className={`text-xs font-bold tabular-nums ${selected ? 'text-white/80' : 'text-text-faint'}`}>{o.count}</span>
          </button>
        );
      })}
    </div>
  );
}

type Option = { value: string; title: string; detail?: React.ReactNode; icon?: React.ReactNode };

// Tappable radio cards (replaces a <select> inside forms and modals): shows
// each option's details, not just its name, and works well with touch.
const OptionList = ({ name, label, value, onChange, options }: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
}) => (
  <div role="radiogroup" aria-label={label} className="grid grid-cols-1 gap-2">
    {options.map(o => {
      const selected = o.value === value;
      return (
        <label
          key={o.value || 'none'}
          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            selected ? 'border-primary bg-surface-warm ring-1 ring-primary' : 'border-border bg-surface-card hover:border-text-faint'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={selected}
            onChange={() => onChange(o.value)}
            className="mt-0.5 accent-[var(--color-primary)] shrink-0"
          />
          {o.icon}
          <span className="min-w-0">
            <span className="block text-sm font-bold text-text">{o.title}</span>
            {o.detail && <span className="block text-xs text-text-warm mt-0.5">{o.detail}</span>}
          </span>
        </label>
      );
    })}
  </div>
);

// Device chooser for the approve/assign modals: a searchable list of the
// unassigned devices, showing code, name and installed location.
const DevicePicker = ({ name, value, onChange, devices, noneLabel }: {
  name: string;
  value: string;
  onChange: (id: string) => void;
  devices: Device[];
  // When set, a first "skip" option with this title (value '').
  noneLabel?: string;
}) => {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = devices.filter(d =>
    d.id === value || !q || [d.device_code, d.label, d.location_desc].some(f => f?.toLowerCase().includes(q))
  );
  const options: Option[] = [
    ...(noneLabel ? [{ value: '', title: noneLabel, detail: 'You can assign one later from the Approved Users tab.' }] : []),
    ...shown.map(d => ({
      value: d.id,
      title: d.device_code,
      detail: [d.label, d.location_desc].filter(Boolean).join(' · ') || undefined,
      icon: <Cpu className="w-4 h-4 mt-0.5 text-primary-dark shrink-0" />,
    })),
  ];
  return (
    <div className="space-y-2">
      {devices.length > 5 && (
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code, name or location"
            aria-label="Search devices"
            className={`${FIELD} pl-9`}
          />
        </div>
      )}
      <div className="max-h-64 overflow-y-auto -mx-1 px-1 py-1">
        <OptionList name={name} label="Device" value={value} onChange={onChange} options={options} />
        {devices.length === 0 ? (
          <p className="text-xs text-amber mt-2 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            No unassigned devices available. Register one under Devices.
          </p>
        ) : shown.length === 0 && (
          <p className="text-xs text-text-warm mt-2">No devices match “{query}”.</p>
        )}
      </div>
    </div>
  );
};

const Identity = ({ name, sub, badge }: { name: string; sub: React.ReactNode; badge?: React.ReactNode }) => (
  <div className="flex items-center gap-3 min-w-0">
    <Avatar name={name} />
    <div className="min-w-0">
      <div className="text-sm font-bold text-text flex items-center gap-2 flex-wrap">
        <span className="truncate">{name}</span>
        {badge}
      </div>
      <div className="text-sm text-text-warm truncate">{sub}</div>
    </div>
  </div>
);

const ErrorNote = ({ message }: { message: string }) => (
  <div className="mb-4 p-3 bg-tier2-bg text-tier2-text text-sm rounded-lg flex items-start gap-2">
    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
    {message}
  </div>
);

// Bottom sheet on phones, centred dialog from sm up; body scrolls if tall.
// Portalled to <body> so it covers the app header, which sits in a separate
// stacking context from the page content.
const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => createPortal(
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 z-[100]" onClick={onClose}>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      className="bg-surface-card w-full sm:max-w-md max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-xl shadow-2xl border border-border"
    >
      <div className="px-5 sm:px-6 py-4 border-b border-border flex justify-between items-center gap-4 shrink-0">
        <h3 className="text-lg sm:text-xl font-black text-text">{title}</h3>
        <button onClick={onClose} className="p-1 -m-1 text-text-faint hover:text-text-body" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-5 sm:p-6 overflow-y-auto">{children}</div>
    </div>
  </div>,
  document.body
);

// Stacked full-width buttons on phones (primary on top), a right-aligned row from sm up.
const ModalActions = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3 [&>button]:w-full sm:[&>button]:w-auto">
    {children}
  </div>
);

type Column<T> = {
  header: string;
  cell: (row: T) => React.ReactNode;
  // Wraps freely (long text) instead of staying on one line.
  wrap?: boolean;
};

// One list per tab, one definition per list: a table from 2xl up (where the
// sidebar still leaves room for every column), labelled cards below it.
function DataList<T>({ rows, rowKey, identity, columns, actions, empty }: {
  rows: T[];
  rowKey: (row: T) => string;
  identity: Column<T>;
  columns: Column<T>[];
  // Return null for rows with nothing to do: the table shows a dash, the card no footer.
  actions?: (row: T) => React.ReactNode;
  empty: React.ReactNode;
}) {
  if (rows.length === 0) {
    return <div className="px-5 py-14 text-center font-medium text-sm text-text-body">{empty}</div>;
  }
  return (
    <>
      <div className="hidden 2xl:block overflow-x-auto">
      <table className={TABLE}>
        <thead>
          <tr className={THEAD_ROW}>
            {[identity, ...columns].map(c => <th key={c.header} className={TH}>{c.header}</th>)}
            {actions && <th className={`${TH} !text-right`}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={rowKey(row)} className={TR}>
              {[identity, ...columns].map(c => (
                <td key={c.header} className={`${TD} text-text ${c.wrap ? 'max-w-xs' : 'whitespace-nowrap'}`}>{c.cell(row)}</td>
              ))}
              {actions && (
                <td className={`${TD} whitespace-nowrap text-right`}>
                  <div className="inline-flex items-center gap-2">{actions(row) ?? <Empty />}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <ul className="2xl:hidden grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 sm:p-4">
        {rows.map(row => {
          const rowActions = actions?.(row);
          return (
          <li key={rowKey(row)} className="border border-border rounded-lg p-4 flex flex-col gap-4 bg-surface-card">
            {identity.cell(row)}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {columns.map(c => (
                <div key={c.header} className={`min-w-0 ${c.wrap ? 'col-span-2' : ''}`}>
                  <dt className="text-text-body font-black text-[10px] uppercase tracking-[0.1em] mb-1">{c.header}</dt>
                  <dd className="text-sm text-text break-words">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {rowActions && <div className="flex gap-2 pt-3 border-t border-border-warm">{rowActions}</div>}
          </li>
          );
        })}
      </ul>
    </>
  );
}

export const Users = () => {
  const { profile: currentProfile } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('approved');
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  // allDevices resolves a user's linked device to its code; devices is the
  // unassigned subset offered in the assign/approve dropdowns.
  const [allDevices, setAllDevices] = useState<Device[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceLoadError, setDeviceLoadError] = useState<LoadErrorInfo | null>(null);

  // Approval/Rejection Modals
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RegistrationRequest | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [selectedDeviceForApproval, setSelectedDeviceForApproval] = useState('');
  const [processingRequest, setProcessingRequest] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  // Original User Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAssignDeviceModal, setShowAssignDeviceModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);

  // Add User State
  const [newUser, setNewUser] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'resident' as Profile['role'],
    contactNumber: '',
  });
  const [addUserLoading, setAddUserLoading] = useState(false);
  const [addUserError, setAddUserError] = useState<string | null>(null);

  // Login email + last sign-in per user id, from manage-user (profiles has no email column)
  const [accounts, setAccounts] = useState<Map<string, AccountInfo>>(new Map());

  // Edit User State
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  // Assign Device State
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch users
      const { data: usersData, error: usersError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (usersError) throw usersError;
      setUsers(usersData || []);

      // Fetch requests with profile data (status, name, contact)
      const { data: reqData, error: reqError } = await supabase
        .from('registration_requests')
        .select(`
          *,
          profile:profiles(full_name, contact_number, status)
        `)
        .order('created_at', { ascending: false });

      if (reqError) throw reqError;

      const formattedRequests = (reqData || []).map((req: any) => ({
        ...req,
        full_name: req.profile?.full_name || 'Unknown',
        contact_number: req.profile?.contact_number || '',
        status: req.profile?.status || 'pending'
      }));

      setRequests(formattedRequests);

      // Fetch unassigned devices (by filtering against profiles)
      const { data: devicesData, error: devicesError } = await supabase
        .from('devices')
        .select<string, Device>(DEVICE_COLUMNS);
      // A failed read must be visible: otherwise the assign-device list silently looks empty.
      setDeviceLoadError(devicesError ? { message: devicesError.message, code: devicesError.code } : null);
      setAllDevices(devicesData || []);

      // Emails are a convenience: a failure here must not hide the user list.
      const { data: accountData, error: accountError } = await supabase.functions.invoke('manage-user', { body: { action: 'list' } });
      if (accountError || accountData?.error) {
        console.error('Error fetching account emails:', accountError || accountData.error);
      } else {
        setAccounts(new Map((accountData.users as (AccountInfo & { id: string })[]).map(a => [a.id, a])));
      }

      if (devicesData && usersData) {
        const assignedIds = new Set(usersData.map(u => u.device_id).filter(Boolean));
        setDevices(devicesData.filter(d => !assignedIds.has(d.id)));
      } else if (devicesData) {
        setDevices(devicesData);
      }

    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (tab: TabType) => {
    setActiveTab(tab);
    setSearchTerm('');
    setRoleFilter('all');
  };

  const openApprove = (req: RegistrationRequest) => {
    setSelectedRequest(req);
    setRequestError(null);
    // Pre-select the device the resident named at sign-up, if it is still free.
    const requested = req.device_code?.trim().toLowerCase();
    const match = requested ? devices.find(d => d.device_code.toLowerCase() === requested) : undefined;
    setSelectedDeviceForApproval(match?.id || '');
    setShowApproveModal(true);
  };

  const openReject = (req: RegistrationRequest) => {
    setSelectedRequest(req);
    setRequestError(null);
    setAdminNotes('');
    setShowRejectModal(true);
  };

  const closeRequestModals = () => {
    setShowApproveModal(false);
    setShowRejectModal(false);
    setSelectedRequest(null);
    setSelectedDeviceForApproval('');
    setAdminNotes('');
    setRequestError(null);
  };

  const handleApprove = async () => {
    if (!selectedRequest) return;
    setProcessingRequest(true);
    setRequestError(null);

    try {
      const { data, error } = await supabase.functions.invoke('manage-registration', {
        body: {
          action: 'approve',
          userId: selectedRequest.user_id,
          device_id: selectedDeviceForApproval || null,
          admin_notes: 'Approved via dashboard'
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // If a device was assigned, we also need to call assign-device to update the devices table
      if (selectedDeviceForApproval && selectedRequest.requested_role === 'resident') {
        const { data: assignData, error: assignErr } = await supabase.functions.invoke('assign-device', {
          body: {
            profile_id: selectedRequest.user_id,
            device_id: selectedDeviceForApproval
          }
        });
        if (assignErr || assignData?.error) {
          throw new Error(`User approved, but the device could not be assigned: ${assignErr?.message || assignData.error}. Use Assign Device on the Approved tab.`);
        }
      }

      closeRequestModals();
      fetchData(); // Refresh all data
    } catch (error: any) {
      setRequestError(error.message || 'Failed to approve request');
      fetchData();
    } finally {
      setProcessingRequest(false);
    }
  };

  const handleReject = async () => {
    if (!selectedRequest) return;
    setProcessingRequest(true);
    setRequestError(null);

    try {
      const { data, error } = await supabase.functions.invoke('manage-registration', {
        body: {
          action: 'reject',
          userId: selectedRequest.user_id,
          admin_notes: adminNotes.trim()
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      closeRequestModals();
      fetchData(); // Refresh all data
    } catch (error: any) {
      setRequestError(error.message || 'Failed to reject request');
    } finally {
      setProcessingRequest(false);
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 11);
    setNewUser({ ...newUser, contactNumber: value });
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddUserLoading(true);
    setAddUserError(null);

    try {
      if (newUser.contactNumber && !/^09\d{9}$/.test(newUser.contactNumber)) {
        throw new Error("Invalid phone format. Must be 11 digits starting with 09");
      }

      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          full_name: newUser.fullName,
          email: newUser.email,
          password: newUser.password,
          role: newUser.role,
          contact_number: newUser.contactNumber
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // create-user already inserts the profile without a status,
      // so it lands on the column default ('approved') - this used
      // to also fire a redundant client-side update here, which RLS
      // silently blocked anyway (no policy lets an admin update
      // another user's profile from the client).
      setShowAddModal(false);
      setNewUser({ fullName: '', email: '', password: '', role: 'resident', contactNumber: '' });
      fetchData();
    } catch (error: any) {
      setAddUserError(error.message || 'Failed to create user');
    } finally {
      setAddUserLoading(false);
    }
  };

  const openEdit = (user: Profile) => {
    setEditUser(user);
    setEditForm({
      fullName: user.full_name,
      email: accounts.get(user.id)?.email ?? '',
      contactNumber: user.contact_number ?? '',
      address: user.address ?? '',
      role: user.role,
      password: '',
    });
    setEditError(null);
    setConfirmDeactivate(false);
  };

  const closeEdit = () => {
    setEditUser(null);
    setEditError(null);
    setConfirmDeactivate(false);
  };

  const invokeManageUser = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('manage-user', { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    if (editForm.contactNumber && !/^09\d{9}$/.test(editForm.contactNumber)) {
      setEditError('Invalid phone format. Must be 11 digits starting with 09');
      return;
    }
    setEditSaving(true);
    setEditError(null);

    // Send only what changed, so an untouched email or role is never re-written.
    const body: Record<string, unknown> = { action: 'update', user_id: editUser.id };
    if (editForm.fullName.trim() !== editUser.full_name) body.full_name = editForm.fullName;
    if (editForm.contactNumber !== (editUser.contact_number ?? '')) body.contact_number = editForm.contactNumber;
    if (editForm.address.trim() !== (editUser.address ?? '')) body.address = editForm.address;
    if (editForm.role !== editUser.role) body.role = editForm.role;
    const currentEmail = accounts.get(editUser.id)?.email ?? '';
    if (editForm.email.trim() && editForm.email.trim().toLowerCase() !== currentEmail.toLowerCase()) body.email = editForm.email;
    if (editForm.password) body.password = editForm.password;

    try {
      if (Object.keys(body).length > 2) await invokeManageUser(body);
      closeEdit();
      fetchData();
    } catch (error: any) {
      setEditError(error.message || 'Failed to save changes');
    } finally {
      setEditSaving(false);
    }
  };

  const handleSetActive = async (active: boolean) => {
    if (!editUser) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await invokeManageUser({ action: 'set_active', user_id: editUser.id, active });
      closeEdit();
      fetchData();
    } catch (error: any) {
      setEditError(error.message || `Failed to ${active ? 'reactivate' : 'deactivate'} user`);
    } finally {
      setEditSaving(false);
    }
  };

  const handleUnassignDevice = async () => {
    if (!editUser) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const { data, error } = await supabase.functions.invoke('assign-device', {
        body: { profile_id: editUser.id, device_id: null }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setEditUser({ ...editUser, device_id: null });
      fetchData();
    } catch (error: any) {
      setEditError(error.message || 'Failed to unassign device');
    } finally {
      setEditSaving(false);
    }
  };

  const openAssign = (user: Profile) => {
    setSelectedUser(user);
    setSelectedDevice('');
    setAssignError(null);
    setShowAssignDeviceModal(true);
  };

  const handleAssignDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !selectedDevice) return;

    setAssignLoading(true);
    setAssignError(null);

    try {
      const { data, error } = await supabase.functions.invoke('assign-device', {
        body: {
          profile_id: selectedUser.id,
          device_id: selectedDevice
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setShowAssignDeviceModal(false);
      setSelectedUser(null);
      setSelectedDevice('');
      fetchData();
    } catch (error: any) {
      setAssignError(error.message || 'Failed to assign device');
    } finally {
      setAssignLoading(false);
    }
  };

  const deviceById = new Map(allDevices.map(d => [d.id, d]));

  // Filter lists based on tab and search term
  const term = searchTerm.trim().toLowerCase();
  const matchesRequest = (r: RegistrationRequest) =>
    r.full_name.toLowerCase().includes(term) || r.email.toLowerCase().includes(term);

  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const pendingRequests = requests.filter(r => r.status === 'pending' && matchesRequest(r));
  const rejectedRequests = requests.filter(r => r.status === 'rejected' && matchesRequest(r));

  // profiles has no email column (confirmed in 20260717000000_init.sql); the
  // login email comes from manage-user's list into `accounts`.
  const searchedUsers = users.filter(u => {
    if (u.status !== 'approved') return false;
    const deviceCode = u.device_id ? deviceById.get(u.device_id)?.device_code ?? '' : '';
    const email = accounts.get(u.id)?.email ?? '';
    return u.full_name.toLowerCase().includes(term)
      || email.toLowerCase().includes(term)
      || (u.contact_number ?? '').includes(term)
      || deviceCode.toLowerCase().includes(term);
  });
  const approvedUsers = roleFilter === 'all' ? searchedUsers : searchedUsers.filter(u => u.role === roleFilter);
  // Chip counts follow the search, so each chip says what tapping it will show.
  const roleCount = (role: Profile['role']) => searchedUsers.filter(u => u.role === role).length;
  const ROLE_FILTERS: { value: RoleFilter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: searchedUsers.length },
    { value: 'resident', label: 'Residents', count: roleCount('resident') },
    { value: 'bfp_responder', label: 'BFP Responders', count: roleCount('bfp_responder') },
    { value: 'admin', label: 'Administrators', count: roleCount('admin') },
  ];

  const TABS: { id: TabType; label: string; short: string; count?: number }[] = [
    { id: 'approved', label: 'Approved Users', short: 'Approved' },
    { id: 'pending', label: 'Pending Requests', short: 'Pending', count: pendingCount },
    { id: 'rejected', label: 'Rejected Requests', short: 'Rejected' },
  ];

  const rejectionReason = (notes: string | null) =>
    notes && notes.trim() && notes !== DEFAULT_REJECT_NOTE ? notes : null;

  const requestIdentity: Column<RegistrationRequest> = {
    header: 'User',
    cell: (req) => <Identity name={req.full_name} sub={req.email} />,
  };

  const searchEmpty = (filtered: boolean, none: string) => (
    <p className="font-medium">{filtered ? 'Nothing matches your search' : none}</p>
  );

  return (
    <>
      <div className="space-y-6 md:space-y-8">
        <PageHeader
          title="User Management"
          description="Manage accounts and registration requests."
          actions={
            <button
              onClick={() => { setAddUserError(null); setShowAddModal(true); }}
              className={`${BTN_PRIMARY} h-11 w-full sm:w-auto`}
            >
              <UserPlus className="w-4 h-4" />
              Add User
            </button>
          }
        />

        <div className="space-y-4 md:space-y-6">
          {deviceLoadError && (
            <LoadErrorBanner what="the device list (needed for device assignment)" error={deviceLoadError} onRetry={fetchData} />
          )}

          {/* Tabs: equal-width segments on phones, content-width from sm up */}
          <div role="tablist" className="flex gap-1 bg-surface-card p-1 rounded-lg border border-border shadow-sm w-full sm:w-fit">
            {TABS.map(tab => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => switchTab(tab.id)}
                className={`h-10 px-2 sm:px-5 flex-1 sm:flex-none whitespace-nowrap text-sm rounded-md transition-colors inline-flex items-center justify-center gap-2 min-w-0 ${
                  activeTab === tab.id
                    ? 'bg-[rgba(244,161,133,0.27)] text-primary font-bold'
                    : 'text-text-body font-semibold hover:text-text hover:bg-surface'
                }`}
              >
                <span className="truncate sm:hidden">{tab.short}</span>
                <span className="hidden sm:inline">{tab.label}</span>
                {!!tab.count && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-primary text-white">{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          <div className={TABLE_CARD}>
            <div className="p-3 sm:p-5 border-b border-border flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="relative w-full lg:max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
                <input
                  type="search"
                  placeholder={activeTab === 'approved' ? 'Search name, email, phone or device' : 'Search name or email'}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Search"
                  className={`${FIELD} pl-9`}
                />
              </div>
              {activeTab === 'approved' && (
                <FilterChips label="Filter by role" value={roleFilter} onChange={setRoleFilter} options={ROLE_FILTERS} />
              )}
            </div>

            {loading ? (
              <div className="flex justify-center items-center h-64">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : activeTab === 'pending' ? (
              <DataList
                rows={pendingRequests}
                rowKey={(r) => r.id}
                identity={requestIdentity}
                columns={[
                  { header: 'Requested Role', cell: (r) => <RoleBadge role={r.requested_role} /> },
                  { header: 'Contact', cell: (r) => r.contact_number || <Empty /> },
                  { header: 'Submitted', cell: (r) => <span className="text-text-warm">{formatDate(r.created_at)}</span> },
                  {
                    header: 'Details',
                    wrap: true,
                    cell: (r) => r.requested_role === 'resident' ? (
                      <span className="text-text-body"><span className="font-medium text-text">Device code:</span> {r.device_code || EMPTY}</span>
                    ) : (
                      <div className="text-text-body">
                        <span className="font-medium text-text">{r.organization || EMPTY}</span>
                        {r.position && <div>{r.position}</div>}
                        {r.verification_info && <div className="text-xs text-text-warm mt-1">ID: {r.verification_info}</div>}
                      </div>
                    ),
                  },
                ]}
                actions={(r) => (
                  <>
                    <button onClick={() => openApprove(r)} className={ACTION_APPROVE}>Approve</button>
                    <button onClick={() => openReject(r)} className={ACTION_REJECT}>Reject</button>
                  </>
                )}
                empty={
                  <>
                    <CheckCircle className="mx-auto h-12 w-12 text-border mb-4" />
                    {searchEmpty(!!term, 'No pending requests')}
                  </>
                }
              />
            ) : activeTab === 'rejected' ? (
              <DataList
                rows={rejectedRequests}
                rowKey={(r) => r.id}
                identity={requestIdentity}
                columns={[
                  { header: 'Requested Role', cell: (r) => <RoleBadge role={r.requested_role} /> },
                  { header: 'Submitted', cell: (r) => <span className="text-text-warm">{formatDate(r.created_at)}</span> },
                  { header: 'Rejected', cell: (r) => <span className="text-text-warm">{formatDate(r.reviewed_at)}</span> },
                  {
                    header: 'Reason',
                    wrap: true,
                    cell: (r) => {
                      const reason = rejectionReason(r.admin_notes);
                      return reason
                        ? <span className="text-text">{reason}</span>
                        : <span className="text-text-warm italic">No reason given</span>;
                    },
                  },
                ]}
                empty={
                  <>
                    <UserX className="mx-auto h-12 w-12 text-border mb-4" />
                    {searchEmpty(!!term, 'No rejected requests')}
                  </>
                }
              />
            ) : (
              <DataList
                rows={approvedUsers}
                rowKey={(u) => u.id}
                identity={{
                  header: 'User',
                  cell: (u) => (
                    <Identity
                      name={u.full_name}
                      sub={accounts.get(u.id)?.email || `Joined ${formatDate(u.created_at)}`}
                      badge={u.id === currentProfile?.id && (
                        <span className="text-xs bg-border text-text-body px-2 py-0.5 rounded-full font-semibold">You</span>
                      )}
                    />
                  ),
                }}
                columns={[
                  { header: 'Role', cell: (u) => <RoleBadge role={u.role} /> },
                  {
                    header: 'Status',
                    cell: (u) => {
                      const lastSignIn = accounts.get(u.id)?.last_sign_in_at;
                      return (
                        <>
                          {u.is_active === false
                            ? <span className={PILL_OFF}>Deactivated</span>
                            : <span className={PILL_OK}>Active</span>}
                          {accounts.has(u.id) && (
                            <div className="text-xs text-text-warm mt-1">
                              {lastSignIn ? `Last sign-in ${formatDate(lastSignIn)}` : 'Never signed in'}
                            </div>
                          )}
                        </>
                      );
                    },
                  },
                  {
                    header: 'Device',
                    cell: (u) => {
                      if (u.role !== 'resident') return <Empty />;
                      const device = u.device_id ? deviceById.get(u.device_id) : undefined;
                      return (
                        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                          {u.device_id ? (
                            <span className={PILL_OK} title={device?.label || undefined}>
                              <Cpu className="w-3 h-3" /> {device?.device_code || 'Assigned'}
                            </span>
                          ) : (
                            <span className={PILL_WARN}><Cpu className="w-3 h-3" /> Unassigned</span>
                          )}
                          {u.is_active !== false && (
                            <button onClick={() => openAssign(u)} className="inline-flex items-center gap-1 text-xs font-bold text-teal-light hover:text-teal">
                              <Link className="w-3 h-3" />
                              {u.device_id ? 'Change' : 'Assign'}
                            </button>
                          )}
                        </div>
                      );
                    },
                  },
                  {
                    header: 'Contact',
                    cell: (u) => (
                      <>
                        <div className="whitespace-nowrap">{u.contact_number || <Empty />}</div>
                        {u.address && (
                          <div className="text-xs text-text-warm mt-0.5 2xl:max-w-[14rem] 2xl:truncate" title={u.address}>{u.address}</div>
                        )}
                      </>
                    ),
                  },
                  {
                    header: 'Telegram Alerts',
                    cell: (u) => u.role === 'admin'
                      ? <Empty />
                      : u.telegram_chat_id
                        ? <span className="text-success-dark font-semibold">Connected</span>
                        : <span className="text-amber font-semibold">Not connected</span>,
                  },
                ]}
                actions={(u) => (
                  <button onClick={() => openEdit(u)} className={ACTION_EDIT}>
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
                )}
                empty={
                  <>
                    <UsersIcon className="mx-auto h-12 w-12 text-border mb-4" />
                    {searchEmpty(!!term || roleFilter !== 'all', 'No approved users yet')}
                  </>
                }
              />
            )}
          </div>
        </div>
      </div>

      {/* Approve Modal */}
      {showApproveModal && selectedRequest && (
        <Modal title="Approve Request" onClose={closeRequestModals}>
          {requestError && <ErrorNote message={requestError} />}
          <p className="text-text-body">
            You are about to approve <strong className="text-text">{selectedRequest.full_name}</strong> as <strong className="text-text">{getRoleLabel(selectedRequest.requested_role)}</strong>.
          </p>

          {selectedRequest.requested_role === 'resident' && (
            <div className="mt-5">
              <p className={LABEL}>Assign a device <span className="font-medium text-text-warm">(optional)</span></p>
              {selectedRequest.device_code && (
                <p className={`text-xs mb-2 font-medium ${selectedDeviceForApproval ? 'text-success-dark' : 'text-amber'}`}>
                  Device code entered at sign-up: {selectedRequest.device_code}
                  {!selectedDeviceForApproval && ' (not found among unassigned devices)'}
                </p>
              )}
              <DevicePicker
                name="approve-device"
                value={selectedDeviceForApproval}
                onChange={setSelectedDeviceForApproval}
                devices={devices}
                noneLabel="Don't assign yet"
              />
            </div>
          )}

          <ModalActions>
            <button onClick={closeRequestModals} className={BTN_SECONDARY} disabled={processingRequest}>
              Cancel
            </button>
            <button onClick={handleApprove} disabled={processingRequest} className={BTN_SUCCESS}>
              {processingRequest && <Loader2 className="w-4 h-4 animate-spin" />}
              Approve
            </button>
          </ModalActions>
        </Modal>
      )}

      {/* Reject Modal */}
      {showRejectModal && selectedRequest && (
        <Modal title="Reject Request" onClose={closeRequestModals}>
          {requestError && <ErrorNote message={requestError} />}
          <p className="text-text-body mb-4">
            You are about to reject <strong className="text-text">{selectedRequest.full_name}</strong>. Add a reason (optional) — it is shown on the Rejected Requests tab.
          </p>

          <label className={LABEL} htmlFor="reject-reason">Reason</label>
          <textarea
            id="reject-reason"
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            placeholder="e.g. Invalid organization ID"
            className={`${FIELD} h-24 py-2 resize-none`}
          />

          <ModalActions>
            <button onClick={closeRequestModals} className={BTN_SECONDARY} disabled={processingRequest}>
              Cancel
            </button>
            <button onClick={handleReject} disabled={processingRequest} className={BTN_PRIMARY}>
              {processingRequest && <Loader2 className="w-4 h-4 animate-spin" />}
              Reject
            </button>
          </ModalActions>
        </Modal>
      )}

      {/* Assign Device Modal */}
      {showAssignDeviceModal && selectedUser && (
        <Modal title={selectedUser.device_id ? 'Reassign Device' : 'Assign Device'} onClose={() => setShowAssignDeviceModal(false)}>
          {assignError && <ErrorNote message={assignError} />}

          <form onSubmit={handleAssignDevice}>
            <p className="text-sm text-text-body mb-4">
              Assigning a device to <span className="font-bold text-text">{selectedUser.full_name}</span>
              {selectedUser.device_id && (
                <> (currently <span className="font-bold text-text">{deviceById.get(selectedUser.device_id)?.device_code || 'assigned'}</span>)</>
              )}
            </p>

            <p className={LABEL}>Choose an unassigned device</p>
            <DevicePicker
              name="assign-device"
              value={selectedDevice}
              onChange={setSelectedDevice}
              devices={devices}
            />

            <ModalActions>
              <button type="button" onClick={() => setShowAssignDeviceModal(false)} className={BTN_SECONDARY}>
                Cancel
              </button>
              <button type="submit" disabled={assignLoading || !selectedDevice} className={BTN_PRIMARY}>
                {assignLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {selectedUser.device_id ? 'Reassign Device' : 'Assign Device'}
              </button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {/* Edit User Modal */}
      {editUser && (() => {
        const isSelf = editUser.id === currentProfile?.id;
        const deactivated = editUser.is_active === false;
        const linkedDevice = editUser.device_id ? deviceById.get(editUser.device_id) : undefined;
        const releasesDevice = editUser.role === 'resident' && !!editUser.device_id && editForm.role !== 'resident';
        return (
          <Modal title="Edit User" onClose={closeEdit}>
            <form onSubmit={handleSaveUser}>
              {editError && <ErrorNote message={editError} />}

              <div className="flex items-center gap-3 mb-5">
                <Avatar name={editUser.full_name} />
                <div className="min-w-0 text-sm">
                  <div className="font-bold text-text truncate">{editUser.full_name}</div>
                  <div className="text-text-warm">
                    Joined {formatDate(editUser.created_at)}{deactivated && ' · Deactivated'}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className={LABEL} htmlFor="edit-name">Full Name</label>
                  <input
                    id="edit-name"
                    type="text"
                    required
                    maxLength={120}
                    value={editForm.fullName}
                    onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                    className={FIELD}
                  />
                </div>

                <div>
                  <label className={LABEL} htmlFor="edit-email">Login Email</label>
                  <input
                    id="edit-email"
                    type="email"
                    autoComplete="off"
                    value={editForm.email}
                    placeholder={accounts.has(editUser.id) ? '' : 'Could not load the current email'}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className={FIELD}
                  />
                  <p className="text-xs text-text-warm mt-1">The user signs in with this address. Changes apply immediately.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={LABEL} htmlFor="edit-phone">Contact Number</label>
                    <input
                      id="edit-phone"
                      type="tel"
                      inputMode="numeric"
                      maxLength={11}
                      placeholder="09XXXXXXXXX"
                      value={editForm.contactNumber}
                      onChange={(e) => setEditForm({ ...editForm, contactNumber: e.target.value.replace(/\D/g, '').slice(0, 11) })}
                      className={FIELD}
                    />
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="edit-password">New Temporary Password</label>
                    <input
                      id="edit-password"
                      type="password"
                      minLength={6}
                      autoComplete="new-password"
                      placeholder="Leave blank to keep"
                      value={editForm.password}
                      onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                      className={FIELD}
                    />
                  </div>
                </div>

                <div>
                  <label className={LABEL} htmlFor="edit-address">Address</label>
                  <textarea
                    id="edit-address"
                    maxLength={300}
                    value={editForm.address}
                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                    className={`${FIELD} h-20 py-2 resize-none`}
                  />
                </div>

                <div>
                  <p className={LABEL}>Role</p>
                  {isSelf ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <RoleBadge role={editUser.role} />
                      <span className="text-xs text-text-warm">You can't change your own role.</span>
                    </div>
                  ) : (
                    <OptionList
                      name="edit-role"
                      label="Role"
                      value={editForm.role}
                      onChange={(v) => setEditForm({ ...editForm, role: v as Profile['role'] })}
                      options={ROLE_OPTIONS}
                    />
                  )}
                  {releasesDevice && (
                    <p className="text-xs text-amber mt-2 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      Saving will unassign {linkedDevice?.device_code || 'their device'} — only residents can have a device.
                    </p>
                  )}
                </div>

                {editUser.role === 'resident' && (
                  <div>
                    <p className={LABEL}>Device</p>
                    <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border">
                      <div className="flex items-center gap-2 min-w-0 text-sm">
                        <Cpu className="w-4 h-4 text-primary-dark shrink-0" />
                        {linkedDevice ? (
                          <span className="min-w-0 truncate"><span className="font-bold text-text">{linkedDevice.device_code}</span>{linkedDevice.label && <span className="text-text-warm"> · {linkedDevice.label}</span>}</span>
                        ) : editUser.device_id ? (
                          <span className="font-bold text-text">Assigned</span>
                        ) : (
                          <span className="text-text-warm">No device assigned</span>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {editUser.device_id && (
                          <button type="button" onClick={handleUnassignDevice} disabled={editSaving} className={`${ACTION} border border-border text-primary hover:bg-tier2-bg`}>
                            Unassign
                          </button>
                        )}
                        {!deactivated && (
                          <button type="button" onClick={() => { const u = editUser; closeEdit(); openAssign(u); }} className={`${ACTION} border border-border text-teal-light hover:bg-surface`}>
                            {editUser.device_id ? 'Change' : 'Assign'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <ModalActions>
                <button type="button" onClick={closeEdit} className={BTN_SECONDARY} disabled={editSaving}>
                  Cancel
                </button>
                <button type="submit" disabled={editSaving} className={BTN_PRIMARY}>
                  {editSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Changes
                </button>
              </ModalActions>
            </form>

            {!isSelf && (
              <div className="mt-6 pt-5 border-t border-border">
                <p className="text-sm font-bold text-text">{deactivated ? 'Reactivate account' : 'Deactivate account'}</p>
                <p className="text-xs text-text-warm mt-1 mb-3">
                  {deactivated
                    ? 'The user can sign in again and will receive alerts.'
                    : 'The user is signed out, cannot sign in, and stops receiving alerts. Their history is kept and you can reactivate them later.'}
                </p>
                {deactivated ? (
                  <button type="button" onClick={() => handleSetActive(true)} disabled={editSaving} className={`${BTN_SECONDARY} w-full sm:w-auto`}>
                    Reactivate {editUser.full_name.split(' ')[0]}
                  </button>
                ) : confirmDeactivate ? (
                  <div className="flex flex-col-reverse sm:flex-row gap-2">
                    <button type="button" onClick={() => setConfirmDeactivate(false)} disabled={editSaving} className={`${BTN_SECONDARY} w-full sm:w-auto`}>
                      Keep Active
                    </button>
                    <button type="button" onClick={() => handleSetActive(false)} disabled={editSaving} className={`${BTN_PRIMARY} w-full sm:w-auto`}>
                      {editSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                      Yes, Deactivate
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmDeactivate(true)} className={`${BTN} border border-tier2-border/40 text-primary bg-surface-card hover:bg-tier2-bg w-full sm:w-auto`}>
                    Deactivate {editUser.full_name.split(' ')[0]}
                  </button>
                )}
              </div>
            )}
          </Modal>
        );
      })()}

      {/* Add User Modal */}
      {showAddModal && (
        <Modal title="Add User" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleAddUser}>
            {addUserError && <ErrorNote message={addUserError} />}

            <div className="space-y-4">
              <div>
                <label className={LABEL} htmlFor="new-name">Full Name</label>
                <input
                  id="new-name"
                  type="text"
                  required
                  autoComplete="off"
                  value={newUser.fullName}
                  onChange={(e) => setNewUser({...newUser, fullName: e.target.value})}
                  className={FIELD}
                />
              </div>

              <div>
                <label className={LABEL} htmlFor="new-email">Email</label>
                <input
                  id="new-email"
                  type="email"
                  required
                  autoComplete="off"
                  value={newUser.email}
                  onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                  className={FIELD}
                />
              </div>

              <div>
                <p className={LABEL}>Role</p>
                <OptionList
                  name="new-role"
                  label="Role"
                  value={newUser.role}
                  onChange={(v) => setNewUser({...newUser, role: v as Profile['role']})}
                  options={ROLE_OPTIONS}
                />
              </div>

              <div>
                <label className={LABEL} htmlFor="new-phone">Contact Number <span className="font-medium text-text-warm">(optional)</span></label>
                <input
                  id="new-phone"
                  type="tel"
                  inputMode="numeric"
                  value={newUser.contactNumber}
                  onChange={handlePhoneChange}
                  maxLength={11}
                  placeholder="09XXXXXXXXX"
                  className={FIELD}
                />
              </div>

              <div>
                <label className={LABEL} htmlFor="new-password">Temporary Password</label>
                <input
                  id="new-password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                  className={FIELD}
                />
                <p className="text-xs text-text-warm mt-1">At least 6 characters. Share it with the user so they can sign in.</p>
              </div>
            </div>

            <ModalActions>
              <button type="button" onClick={() => setShowAddModal(false)} className={BTN_SECONDARY}>
                Cancel
              </button>
              <button type="submit" disabled={addUserLoading} className={BTN_PRIMARY}>
                {addUserLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Add User
              </button>
            </ModalActions>
          </form>
        </Modal>
      )}
    </>
  );
};
