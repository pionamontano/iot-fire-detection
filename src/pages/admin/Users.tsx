import React, { useState, useEffect } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { supabase } from '../../lib/supabase';
import { DEVICE_COLUMNS } from '../../lib/deviceColumns';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import type { Profile, RegistrationRequest, Device } from '../../lib/supabase';
import {
  UserPlus, Cpu,
  Loader2, Link, CheckCircle,
  Search, X, AlertCircle, ShieldAlert
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

// One placeholder for every missing value on this page.
const EMPTY = '—';
const Empty = () => <span className="text-[#8D7F7D]">{EMPTY}</span>;

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

const TH_BASE = 'px-6 py-4 text-xs font-bold text-[#534341] uppercase tracking-wider';
const TH = `${TH_BASE} text-left`;
const INPUT = 'w-full px-3 py-2 border border-[#E5E2E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-sm';
const BTN_SECONDARY = 'px-4 py-2 border border-[#E5E2E1] text-[#534341] rounded-lg hover:bg-[#FCF9F8] font-bold text-sm transition-colors disabled:opacity-50';
const BTN_PRIMARY = 'px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark font-bold text-sm transition-colors flex items-center shadow-sm disabled:opacity-50';

type TabType = 'approved' | 'pending' | 'rejected';
type RoleFilter = 'all' | Profile['role'];

const getRoleBadgeColor = (role: string) => {
  switch (role) {
    case 'admin': return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'bfp_responder': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'resident': return 'bg-green-100 text-green-800 border-green-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

const getRoleLabel = (role: string) => {
  switch (role) {
    case 'admin': return 'Administrator';
    case 'bfp_responder': return 'BFP Responder';
    case 'resident': return 'Resident / Owner';
    default: return role;
  }
};

const RoleBadge = ({ role }: { role: string }) => (
  <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${getRoleBadgeColor(role)}`}>
    {getRoleLabel(role)}
  </span>
);

const Avatar = ({ name }: { name: string }) => (
  <div className="w-10 h-10 shrink-0 rounded-full bg-[#FCF9F8] border border-[#E5E2E1] flex items-center justify-center font-bold text-[#534341]">
    {name.charAt(0).toUpperCase()}
  </div>
);

const ErrorNote = ({ message }: { message: string }) => (
  <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-center gap-2">
    <ShieldAlert className="w-4 h-4 shrink-0" />
    {message}
  </div>
);

const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-[#E5E2E1]">
      <div className="px-6 py-4 border-b border-[#E5E2E1] flex justify-between items-center">
        <h3 className="text-xl font-black text-[#231918]">{title}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-6">{children}</div>
    </div>
  </div>
);

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
  const formatDeviceOption = (device: Device) => device.label ? `${device.device_code} - ${device.label}` : device.device_code;

  // Filter lists based on tab and search term
  const term = searchTerm.trim().toLowerCase();
  const matchesRequest = (r: RegistrationRequest) =>
    r.full_name.toLowerCase().includes(term) || r.email.toLowerCase().includes(term);

  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const pendingRequests = requests.filter(r => r.status === 'pending' && matchesRequest(r));
  const rejectedRequests = requests.filter(r => r.status === 'rejected' && matchesRequest(r));

  // profiles has no email column (confirmed in 20260717000000_init.sql) - email
  // only exists on registration_requests, which is why that table's own search
  // can match on it but this one can only match on name, phone and device code.
  const approvedUsers = users.filter(u => {
    if (u.status !== 'approved') return false;
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    const deviceCode = u.device_id ? deviceById.get(u.device_id)?.device_code ?? '' : '';
    return u.full_name.toLowerCase().includes(term)
      || (u.contact_number ?? '').includes(term)
      || deviceCode.toLowerCase().includes(term);
  });

  const tabClass = (tab: TabType) =>
    `px-6 py-2.5 text-sm rounded-md transition-colors flex items-center gap-2 ${
      activeTab === tab
        ? 'bg-[rgba(244,161,133,0.27)] text-primary font-bold'
        : 'text-[#534341] font-semibold hover:text-[#231918] hover:bg-gray-50'
    }`;

  const rejectionReason = (notes: string | null) =>
    notes && notes.trim() && notes !== DEFAULT_REJECT_NOTE ? notes : null;

  return (
    <>
      <div className="space-y-8">
        <PageHeader
          title="User Management"
          description="Manage accounts and registration requests."
          actions={
            <button
              onClick={() => { setAddUserError(null); setShowAddModal(true); }}
              className="h-11 bg-primary text-white px-4 rounded-lg flex items-center gap-2 font-semibold text-sm hover:bg-primary-dark transition-colors shadow-sm"
            >
              <UserPlus className="w-4 h-4" />
              Add User
            </button>
          }
        />

        <div>
          {deviceLoadError && (
            <div className="mb-6"><LoadErrorBanner what="the device list (needed for device assignment)" error={deviceLoadError} onRetry={fetchData} /></div>
          )}
          {/* Tabs */}
          <div role="tablist" className="flex flex-wrap gap-1 bg-white p-1 rounded-lg border border-[#E5E2E1] shadow-sm mb-6 w-fit max-w-full">
            <button role="tab" aria-selected={activeTab === 'approved'} onClick={() => switchTab('approved')} className={tabClass('approved')}>
              Approved Users
            </button>
            <button role="tab" aria-selected={activeTab === 'pending'} onClick={() => switchTab('pending')} className={tabClass('pending')}>
              Pending Requests
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-primary text-white">
                  {pendingCount}
                </span>
              )}
            </button>
            <button role="tab" aria-selected={activeTab === 'rejected'} onClick={() => switchTab('rejected')} className={tabClass('rejected')}>
              Rejected Requests
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-[#E5E2E1] overflow-hidden">
            <div className="p-4 border-b border-[#E5E2E1] bg-[#FCF9F8] flex flex-wrap gap-3 items-center">
              <div className="relative w-full sm:w-80">
                <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder={activeTab === 'approved' ? 'Search by name, phone or device code...' : 'Search by name or email...'}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-[#E5E2E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-sm bg-white"
                />
              </div>
              {activeTab === 'approved' && (
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
                  aria-label="Filter by role"
                  className="px-3 py-2 border border-[#E5E2E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-sm bg-white"
                >
                  <option value="all">All roles</option>
                  <option value="resident">Resident / Owner</option>
                  <option value="bfp_responder">BFP Responder</option>
                  <option value="admin">Administrator</option>
                </select>
              )}
            </div>

            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex justify-center items-center h-64">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              ) : activeTab === 'pending' ? (
                // PENDING REQUESTS TABLE
                <table className="min-w-full divide-y divide-[#E5E2E1]">
                  <thead className="bg-[#FCF9F8]">
                    <tr>
                      <th className={TH}>User</th>
                      <th className={TH}>Requested Role</th>
                      <th className={TH}>Contact</th>
                      <th className={TH}>Details</th>
                      <th className={TH}>Submitted</th>
                      <th className={`${TH_BASE} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-[#E5E2E1]">
                    {pendingRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <Avatar name={req.full_name} />
                            <div className="ml-4">
                              <div className="text-sm font-bold text-[#231918]">{req.full_name}</div>
                              <div className="text-sm text-[#8D7F7D]">{req.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <RoleBadge role={req.requested_role} />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-[#231918]">
                          {req.contact_number || <Empty />}
                        </td>
                        <td className="px-6 py-4">
                          {req.requested_role === 'resident' ? (
                            <div className="text-sm text-[#534341]">
                              <span className="font-medium text-[#231918]">Device code:</span> {req.device_code || EMPTY}
                            </div>
                          ) : (
                            <div className="text-sm text-[#534341]">
                              <span className="font-medium text-[#231918]">{req.organization || EMPTY}</span>
                              {req.position && <><br/>{req.position}</>}
                              {req.verification_info && <div className="text-xs text-gray-500 mt-1">ID: {req.verification_info}</div>}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-[#8D7F7D]">
                          {formatDate(req.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => openApprove(req)}
                            className="text-[#047857] hover:text-[#065F46] bg-[#ECFDF5] px-3 py-1.5 rounded mr-2 font-bold transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => openReject(req)}
                            className="text-[#DC2626] hover:text-[#991B1B] bg-[#FEF2F2] px-3 py-1.5 rounded font-bold transition-colors"
                          >
                            Reject
                          </button>
                        </td>
                      </tr>
                    ))}
                    {pendingRequests.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-[#534341]">
                          <CheckCircle className="mx-auto h-12 w-12 text-gray-300 mb-4" />
                          <p className="font-medium">{term ? 'No pending requests match your search' : 'No pending requests'}</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : activeTab === 'rejected' ? (
                // REJECTED REQUESTS TABLE
                <table className="min-w-full divide-y divide-[#E5E2E1]">
                  <thead className="bg-[#FCF9F8]">
                    <tr>
                      <th className={TH}>User</th>
                      <th className={TH}>Requested Role</th>
                      <th className={TH}>Reason</th>
                      <th className={TH}>Submitted</th>
                      <th className={TH}>Rejected</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-[#E5E2E1]">
                    {rejectedRequests.map((req) => {
                      const reason = rejectionReason(req.admin_notes);
                      return (
                        <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <Avatar name={req.full_name} />
                              <div className="ml-4">
                                <div className="text-sm font-bold text-[#231918]">{req.full_name}</div>
                                <div className="text-sm text-[#8D7F7D]">{req.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <RoleBadge role={req.requested_role} />
                          </td>
                          <td className="px-6 py-4">
                            <div className={`text-sm ${reason ? 'text-[#231918]' : 'text-[#8D7F7D] italic'}`}>{reason || 'No reason given'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-[#8D7F7D]">
                            {formatDate(req.created_at)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-[#8D7F7D]">
                            {formatDate(req.reviewed_at)}
                          </td>
                        </tr>
                      );
                    })}
                    {rejectedRequests.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-[#534341]">
                          <p className="font-medium">{term ? 'No rejected requests match your search' : 'No rejected requests'}</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                // APPROVED USERS TABLE
                <table className="min-w-full divide-y divide-[#E5E2E1]">
                  <thead className="bg-[#FCF9F8]">
                    <tr>
                      <th className={TH}>User</th>
                      <th className={TH}>Role</th>
                      <th className={TH}>Contact</th>
                      <th className={TH}>Device</th>
                      <th className={TH}>Telegram Alerts</th>
                      <th className={`${TH_BASE} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-[#E5E2E1]">
                    {approvedUsers.map((user) => {
                      const device = user.device_id ? deviceById.get(user.device_id) : undefined;
                      return (
                        <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <Avatar name={user.full_name} />
                              <div className="ml-4">
                                <div className="text-sm font-bold text-[#231918]">
                                  {user.full_name}
                                  {user.id === currentProfile?.id && (
                                    <span className="ml-2 text-xs bg-[#E5E2E1] text-[#534341] px-2 py-0.5 rounded-full">You</span>
                                  )}
                                </div>
                                <div className="text-sm text-[#8D7F7D]">Joined {formatDate(user.created_at)}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <RoleBadge role={user.role} />
                          </td>
                          <td className="px-6 py-4 text-sm text-[#231918]">
                            <div className="whitespace-nowrap">{user.contact_number || <Empty />}</div>
                            {user.address && (
                              <div className="text-xs text-[#8D7F7D] mt-0.5 max-w-[16rem] truncate" title={user.address}>{user.address}</div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            {user.role !== 'resident' ? (
                              <Empty />
                            ) : user.device_id ? (
                              <span className="inline-flex items-center text-[#047857] bg-[#ECFDF5] px-2.5 py-1 rounded-md text-xs font-bold border border-[#A7F3D0]" title={device?.label || undefined}>
                                <Cpu className="w-3 h-3 mr-1" /> {device?.device_code || 'Assigned'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center text-[#D97706] bg-[#FFFBEB] px-2.5 py-1 rounded-md text-xs font-bold border border-[#FDE68A]">
                                <Cpu className="w-3 h-3 mr-1" /> Unassigned
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            {user.role === 'admin' ? (
                              <Empty />
                            ) : user.telegram_chat_id ? (
                              <span className="text-[#047857] font-semibold">Connected</span>
                            ) : (
                              <span className="text-[#D97706] font-semibold">Not connected</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            {user.role === 'resident' ? (
                              <button
                                onClick={() => openAssign(user)}
                                className="text-[#00799C] hover:text-[#005c77] inline-flex items-center font-bold"
                              >
                                <Link className="w-4 h-4 mr-1" />
                                {user.device_id ? 'Reassign' : 'Assign'} Device
                              </button>
                            ) : (
                              <Empty />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {approvedUsers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-[#534341]">
                          <p className="font-medium">{term || roleFilter !== 'all' ? 'No users match your filters' : 'No approved users yet'}</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Approve Modal */}
      {showApproveModal && selectedRequest && (
        <Modal title="Approve Request" onClose={closeRequestModals}>
          {requestError && <ErrorNote message={requestError} />}
          <p className="text-[#534341] mb-6">
            You are about to approve <strong>{selectedRequest.full_name}</strong> as <strong>{getRoleLabel(selectedRequest.requested_role)}</strong>.
          </p>

          {selectedRequest.requested_role === 'resident' && (
            <div className="mb-6">
              <label className="block text-sm font-bold text-[#231918] mb-2">Assign Device (Optional)</label>
              {selectedRequest.device_code && (
                <p className={`text-xs mb-2 font-medium ${selectedDeviceForApproval ? 'text-[#047857]' : 'text-[#D97706]'}`}>
                  Device code entered at sign-up: {selectedRequest.device_code}
                  {!selectedDeviceForApproval && ' (not found among unassigned devices)'}
                </p>
              )}
              <select
                value={selectedDeviceForApproval}
                onChange={(e) => setSelectedDeviceForApproval(e.target.value)}
                className={INPUT}
              >
                <option value="">Do not assign yet</option>
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {formatDeviceOption(device)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button onClick={closeRequestModals} className={BTN_SECONDARY} disabled={processingRequest}>
              Cancel
            </button>
            <button
              onClick={handleApprove}
              disabled={processingRequest}
              className="px-4 py-2 bg-[#047857] text-white rounded-lg hover:bg-[#065F46] font-bold text-sm transition-colors flex items-center shadow-sm disabled:opacity-50"
            >
              {processingRequest ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Approve
            </button>
          </div>
        </Modal>
      )}

      {/* Reject Modal */}
      {showRejectModal && selectedRequest && (
        <Modal title="Reject Request" onClose={closeRequestModals}>
          {requestError && <ErrorNote message={requestError} />}
          <p className="text-[#534341] mb-4">
            You are about to reject <strong>{selectedRequest.full_name}</strong>. Add a reason (optional) — it is shown on the Rejected Requests tab.
          </p>

          <textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            placeholder="e.g. Invalid organization ID"
            className={`${INPUT} mb-6 resize-none h-24`}
          />

          <div className="flex gap-3 justify-end">
            <button onClick={closeRequestModals} className={BTN_SECONDARY} disabled={processingRequest}>
              Cancel
            </button>
            <button onClick={handleReject} disabled={processingRequest} className={BTN_PRIMARY}>
              {processingRequest ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Reject
            </button>
          </div>
        </Modal>
      )}

      {/* Assign Device Modal */}
      {showAssignDeviceModal && selectedUser && (
        <Modal title={selectedUser.device_id ? 'Reassign Device' : 'Assign Device'} onClose={() => setShowAssignDeviceModal(false)}>
          {assignError && <ErrorNote message={assignError} />}

          <form onSubmit={handleAssignDevice}>
            <div className="mb-6">
              <div className="text-sm text-[#534341] mb-4">
                Assigning a device to <span className="font-bold text-[#231918]">{selectedUser.full_name}</span>
                {selectedUser.device_id && (
                  <> (currently <span className="font-bold text-[#231918]">{deviceById.get(selectedUser.device_id)?.device_code || 'assigned'}</span>)</>
                )}
              </div>

              <label className="block text-sm font-bold text-[#231918] mb-2">Unassigned Devices</label>
              <select
                required
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                className={INPUT}
              >
                <option value="">Select a device</option>
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {formatDeviceOption(device)}
                  </option>
                ))}
              </select>
              {devices.length === 0 && (
                <p className="text-xs text-[#D97706] mt-2 flex items-center">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  No unassigned devices available.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowAssignDeviceModal(false)} className={BTN_SECONDARY}>
                Cancel
              </button>
              <button type="submit" disabled={assignLoading || !selectedDevice} className={BTN_PRIMARY}>
                {assignLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {selectedUser.device_id ? 'Reassign Device' : 'Assign Device'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add User Modal */}
      {showAddModal && (
        <Modal title="Add User" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleAddUser}>
            {addUserError && <ErrorNote message={addUserError} />}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-[#231918] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={newUser.fullName}
                  onChange={(e) => setNewUser({...newUser, fullName: e.target.value})}
                  className={INPUT}
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-[#231918] mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={newUser.email}
                  onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                  className={INPUT}
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-[#231918] mb-1">Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({...newUser, role: e.target.value as Profile['role']})}
                  className={INPUT}
                >
                  <option value="resident">Resident / Owner</option>
                  <option value="bfp_responder">BFP Responder</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-[#231918] mb-1">Contact Number</label>
                <input
                  type="tel"
                  value={newUser.contactNumber}
                  onChange={handlePhoneChange}
                  maxLength={11}
                  placeholder="09XXXXXXXXX"
                  className={INPUT}
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-[#231918] mb-1">Temporary Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newUser.password}
                  onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                  className={INPUT}
                />
                <p className="text-xs text-[#8D7F7D] mt-1">At least 6 characters. Share it with the user so they can sign in.</p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowAddModal(false)} className={BTN_SECONDARY}>
                Cancel
              </button>
              <button type="submit" disabled={addUserLoading} className={BTN_PRIMARY}>
                {addUserLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Add User
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
};
