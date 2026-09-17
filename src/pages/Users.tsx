import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile, RegistrationRequest, Device } from '../lib/supabase';
import { 
  Users as UsersIcon, Plus, UserPlus, Shield, Smartphone, 
  MapPin, Loader2, Link, Edit2, Key, CheckCircle, XCircle, 
  Trash2, Search, Filter, ShieldAlert, FileText, Settings, X, User, AlertCircle
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const formatDate = (dateStr: string, includeDay = true) => {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: includeDay ? 'numeric' : undefined,
    year: 'numeric'
  });
};

type TabType = 'active' | 'pending' | 'rejected';

export const Users = () => {
  const { profile: currentProfile } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [devices, setDevices] = useState<Device[]>([]);

  // Approval/Rejection Modals
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RegistrationRequest | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [selectedDeviceForApproval, setSelectedDeviceForApproval] = useState('');
  const [processingRequest, setProcessingRequest] = useState(false);

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
      const { data: devicesData } = await supabase
        .from('devices')
        .select('*');
      
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

  const handleApprove = async () => {
    if (!selectedRequest) return;
    setProcessingRequest(true);
    
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
         await supabase.functions.invoke('assign-device', {
            body: {
              profile_id: selectedRequest.user_id,
              device_id: selectedDeviceForApproval
            }
         });
      }

      setShowApproveModal(false);
      setSelectedRequest(null);
      setSelectedDeviceForApproval('');
      fetchData(); // Refresh all data
    } catch (error: any) {
      alert(`Error approving user: ${error.message}`);
    } finally {
      setProcessingRequest(false);
    }
  };

  const handleReject = async () => {
    if (!selectedRequest) return;
    setProcessingRequest(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('manage-registration', {
        body: {
          action: 'reject',
          userId: selectedRequest.user_id,
          admin_notes: adminNotes || 'Rejected'
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setShowRejectModal(false);
      setSelectedRequest(null);
      setAdminNotes('');
      fetchData(); // Refresh all data
    } catch (error: any) {
      alert(`Error rejecting user: ${error.message}`);
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

      // Force status to approved for manually created users
      await supabase.from('profiles').update({ status: 'approved' }).eq('id', data.user.id);

      setShowAddModal(false);
      setNewUser({ fullName: '', email: '', password: '', role: 'resident', contactNumber: '' });
      fetchData();
    } catch (error: any) {
      setAddUserError(error.message || 'Failed to create user');
    } finally {
      setAddUserLoading(false);
    }
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

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'approved': return 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]';
      case 'pending': return 'bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]';
      case 'rejected': return 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Filter lists based on tab and search term
  const pendingRequests = requests.filter(r => r.status === 'pending' && (
    r.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    r.email.toLowerCase().includes(searchTerm.toLowerCase())
  ));
  
  const rejectedRequests = requests.filter(r => r.status === 'rejected' && (
    r.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    r.email.toLowerCase().includes(searchTerm.toLowerCase())
  ));

  const activeUsers = users.filter(u => u.status === 'approved' && (
    u.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  ));

  return (
    <>
      <div className="flex-1 overflow-auto bg-[#FCF9F8] font-['Inter',_sans-serif]">
        <header className="bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] border-b border-[#E5E2E1] p-6 sticky top-0 z-10">
        <div className="flex justify-between items-center max-w-7xl mx-auto">
          <div>
            <h1 className="text-2xl font-black text-[#231918] tracking-tight">User Management</h1>
            <p className="text-[#534341] text-sm mt-1">Manage accounts and registration requests</p>
          </div>
            {activeTab === 'active' && (
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-[#D32F2F] text-white px-4 py-2.5 rounded-lg flex items-center font-bold text-sm tracking-wide uppercase hover:bg-[#B91C1C] transition-colors shadow-sm"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Add User
              </button>
            )}
          </div>
        </header>

        <main className="p-8 max-w-7xl mx-auto">
          {/* Tabs */}
          <div className="flex space-x-1 bg-white p-1 rounded-lg border border-[#E5E2E1] shadow-sm mb-6 inline-flex">
            <button
              onClick={() => setActiveTab('active')}
              className={`px-6 py-2.5 text-sm font-bold rounded-md transition-colors ${
                activeTab === 'active' 
                  ? 'bg-[#FCF9F8] text-[#D32F2F] shadow-sm' 
                  : 'text-[#534341] hover:text-[#231918] hover:bg-gray-50'
              }`}
            >
              Active Users
            </button>
            <button
              onClick={() => setActiveTab('pending')}
              className={`px-6 py-2.5 text-sm font-bold rounded-md transition-colors flex items-center gap-2 ${
                activeTab === 'pending' 
                  ? 'bg-[#FCF9F8] text-[#D32F2F] shadow-sm' 
                  : 'text-[#534341] hover:text-[#231918] hover:bg-gray-50'
              }`}
            >
              Pending Requests
              {requests.filter(r => r.status === 'pending').length > 0 && (
                <span className={`px-2 py-0.5 rounded-full text-xs ${activeTab === 'pending' ? 'bg-[#D32F2F] text-white' : 'bg-orange-100 text-orange-800'}`}>
                  {requests.filter(r => r.status === 'pending').length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('rejected')}
              className={`px-6 py-2.5 text-sm font-bold rounded-md transition-colors ${
                activeTab === 'rejected' 
                  ? 'bg-[#FCF9F8] text-[#D32F2F] shadow-sm' 
                  : 'text-[#534341] hover:text-[#231918] hover:bg-gray-50'
              }`}
            >
              Rejected
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-[#E5E2E1] overflow-hidden">
            <div className="p-4 border-b border-[#E5E2E1] bg-[#FCF9F8] flex justify-between items-center">
              <div className="relative w-64">
                <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-[#E5E2E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#D32F2F] focus:border-[#D32F2F] text-sm"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex justify-center items-center h-64">
                  <Loader2 className="w-8 h-8 text-[#D32F2F] animate-spin" />
                </div>
              ) : activeTab === 'pending' ? (
                // PENDING REQUESTS TABLE
                <table className="min-w-full divide-y divide-[#E5E2E1]">
                  <thead className="bg-[#FCF9F8]">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Applicant</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Requested Role</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Contact Info</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Additional Info</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Submitted</th>
                      <th className="px-6 py-4 text-right text-xs font-bold text-[#534341] uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-[#E5E2E1]">
                    {pendingRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center font-bold">
                              {req.full_name.charAt(0)}
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-bold text-[#231918]">{req.full_name}</div>
                              <div className="text-sm text-[#8D7F7D]">{req.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${getRoleBadgeColor(req.requested_role)}`}>
                            {getRoleLabel(req.requested_role)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                           <div className="text-sm text-[#231918]">{req.contact_number || 'N/A'}</div>
                        </td>
                        <td className="px-6 py-4">
                          {req.requested_role === 'resident' ? (
                            <div className="text-sm text-[#534341]">
                              <span className="font-medium text-[#231918]">Device ID:</span> {req.device_code || 'None'}
                            </div>
                          ) : (
                            <div className="text-sm text-[#534341]">
                              <span className="font-medium text-[#231918]">{req.organization}</span>
                              <br/>{req.position}
                              {req.verification_info && <div className="text-xs text-gray-500 mt-1">ID: {req.verification_info}</div>}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-[#8D7F7D]">
                          {formatDate(req.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => {
                              setSelectedRequest(req);
                              setShowApproveModal(true);
                            }}
                            className="text-[#047857] hover:text-[#065F46] bg-[#ECFDF5] px-3 py-1.5 rounded mr-2 font-bold transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => {
                              setSelectedRequest(req);
                              setShowRejectModal(true);
                            }}
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
                          <p className="font-medium">No pending registration requests</p>
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
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Applicant</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Role</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Reason for Rejection</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Date Rejected</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-[#E5E2E1]">
                    {rejectedRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-10 h-10 rounded-full bg-red-100 text-red-700 flex items-center justify-center font-bold">
                              {req.full_name.charAt(0)}
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-bold text-[#231918]">{req.full_name}</div>
                              <div className="text-sm text-[#8D7F7D]">{req.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${getRoleBadgeColor(req.requested_role)}`}>
                            {getRoleLabel(req.requested_role)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                           <div className="text-sm text-[#DC2626]">{req.admin_notes || 'No reason provided'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-[#8D7F7D]">
                          {req.reviewed_at ? formatDate(req.reviewed_at) : 'N/A'}
                        </td>
                      </tr>
                    ))}
                    {rejectedRequests.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-[#534341]">
                          <p className="font-medium">No rejected requests</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                // ACTIVE USERS TABLE
                <table className="min-w-full divide-y divide-[#E5E2E1]">
                  <thead className="bg-[#FCF9F8]">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">User</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Role</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Contact</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Device</th>
                      <th className="px-6 py-4 text-right text-xs font-bold text-[#534341] uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-[#E5E2E1]">
                    {activeUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-10 h-10 rounded-full bg-[#FCF9F8] border border-[#E5E2E1] flex items-center justify-center font-bold text-[#534341]">
                              {user.full_name.charAt(0)}
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-bold text-[#231918]">
                                {user.full_name}
                                {user.id === currentProfile?.id && (
                                  <span className="ml-2 text-xs bg-[#E5E2E1] text-[#534341] px-2 py-0.5 rounded-full">You</span>
                                )}
                              </div>
                              <div className="text-sm text-[#8D7F7D]">Member since {formatDate(user.created_at, false)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${getRoleBadgeColor(user.role)}`}>
                            {getRoleLabel(user.role)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-[#231918]">
                          {user.contact_number || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {user.role === 'resident' ? (
                            user.device_id ? (
                              <span className="inline-flex items-center text-[#047857] bg-[#ECFDF5] px-2.5 py-1 rounded-md text-xs font-bold border border-[#A7F3D0]">
                                <Smartphone className="w-3 h-3 mr-1" /> Linked
                              </span>
                            ) : (
                              <span className="inline-flex items-center text-[#D97706] bg-[#FFFBEB] px-2.5 py-1 rounded-md text-xs font-bold border border-[#FDE68A]">
                                <Smartphone className="w-3 h-3 mr-1" /> Not Linked
                              </span>
                            )
                          ) : (
                            <span className="text-[#8D7F7D]">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          {user.role === 'resident' && (
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setShowAssignDeviceModal(true);
                              }}
                              className="text-[#00799C] hover:text-[#005c77] flex items-center justify-end w-full font-bold"
                            >
                              <Link className="w-4 h-4 mr-1" />
                              {user.device_id ? 'Reassign' : 'Assign'} Device
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {activeUsers.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-[#534341]">
                          <p className="font-medium">No active users found</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Approve Modal */}
      {showApproveModal && selectedRequest && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-[#E5E2E1]">
            <h3 className="text-xl font-black text-[#231918] mb-4">Approve Registration</h3>
            <p className="text-[#534341] mb-6">
              You are about to approve <strong>{selectedRequest.full_name}</strong> for the role of <strong>{getRoleLabel(selectedRequest.requested_role)}</strong>.
            </p>
            
            {selectedRequest.requested_role === 'resident' && (
              <div className="mb-6">
                <label className="block text-sm font-bold text-[#231918] mb-2">Assign Device (Optional)</label>
                {selectedRequest.device_code && (
                  <p className="text-xs text-[#047857] mb-2 font-medium">
                    User indicated device code: {selectedRequest.device_code}
                  </p>
                )}
                <select
                  value={selectedDeviceForApproval}
                  onChange={(e) => setSelectedDeviceForApproval(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E5E2E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#D32F2F]"
                >
                  <option value="">Do not assign yet</option>
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.device_code} - {device.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowApproveModal(false)}
                className="px-4 py-2 border border-[#E5E2E1] text-[#534341] rounded-lg hover:bg-[#FCF9F8] font-bold text-sm transition-colors"
                disabled={processingRequest}
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                disabled={processingRequest}
                className="px-4 py-2 bg-[#047857] text-white rounded-lg hover:bg-[#065F46] font-bold text-sm transition-colors flex items-center shadow-sm"
              >
                {processingRequest ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Approve User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && selectedRequest && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-[#E5E2E1]">
            <h3 className="text-xl font-black text-[#231918] mb-4">Reject Registration</h3>
            <p className="text-[#534341] mb-4">
              Rejecting <strong>{selectedRequest.full_name}</strong>. Please provide a reason (optional).
            </p>
            
            <textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="e.g. Invalid organization ID"
              className="w-full px-3 py-2 border border-[#E5E2E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#D32F2F] mb-6 resize-none h-24"
            />
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 border border-[#E5E2E1] text-[#534341] rounded-lg hover:bg-[#FCF9F8] font-bold text-sm transition-colors"
                disabled={processingRequest}
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={processingRequest}
                className="px-4 py-2 bg-[#DC2626] text-white rounded-lg hover:bg-[#B91C1C] font-bold text-sm transition-colors flex items-center shadow-sm"
              >
                {processingRequest ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Device Modal */}
      {showAssignDeviceModal && selectedUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-[#E5E2E1]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black text-[#231918]">Assign Device</h3>
              <button onClick={() => setShowAssignDeviceModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {assignError && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                {assignError}
              </div>
            )}

            <form onSubmit={handleAssignDevice}>
              <div className="mb-6">
                <div className="text-sm text-[#534341] mb-4">
                  Assigning device to <span className="font-bold text-[#231918]">{selectedUser.full_name}</span>
                </div>
                
                <label className="block text-sm font-bold text-[#231918] mb-2">Available Devices</label>
                <select
                  required
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E5E2E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#D32F2F]"
                >
                  <option value="">Select a device</option>
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.device_code} - {device.label}
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
                <button
                  type="button"
                  onClick={() => setShowAssignDeviceModal(false)}
                  className="px-4 py-2 border border-[#E5E2E1] text-[#534341] rounded-lg hover:bg-[#FCF9F8] font-bold text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assignLoading || !selectedDevice}
                  className="px-4 py-2 bg-[#D32F2F] text-white rounded-lg hover:bg-[#B91C1C] font-bold text-sm transition-colors flex items-center shadow-sm disabled:opacity-50"
                >
                  {assignLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Assign Device
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-[#E5E2E1]">
            <div className="px-6 py-4 border-b border-[#E5E2E1] flex justify-between items-center">
              <h3 className="text-xl font-black text-[#231918]">Add Manual User</h3>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleAddUser} className="p-6">
              {addUserError && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" />
                  {addUserError}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-[#231918] mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={newUser.fullName}
                    onChange={(e) => setNewUser({...newUser, fullName: e.target.value})}
                    className="w-full px-3 py-2 border border-[#E5E2E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#D32F2F]"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-[#231918] mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={newUser.email}
                    onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                    className="w-full px-3 py-2 border border-[#E5E2E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#D32F2F]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-[#231918] mb-1">Role</label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({...newUser, role: e.target.value as Profile['role']})}
                    className="w-full px-3 py-2 border border-[#E5E2E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#D32F2F]"
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
                    className="w-full px-3 py-2 border border-[#E5E2E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#D32F2F]"
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
                    className="w-full px-3 py-2 border border-[#E5E2E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#D32F2F]"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-[#E5E2E1] text-[#534341] rounded-lg hover:bg-[#FCF9F8] font-bold text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addUserLoading}
                  className="px-4 py-2 bg-[#D32F2F] text-white rounded-lg hover:bg-[#B91C1C] font-bold text-sm transition-colors flex items-center shadow-sm"
                >
                  {addUserLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};