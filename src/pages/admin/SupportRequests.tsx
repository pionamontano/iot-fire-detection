import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import type { SupportRequest } from '../../lib/supabase';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import { Loader2, CheckCircle, X, Mail, Phone } from 'lucide-react';

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const getRoleLabel = (role: string | null) => {
  switch (role) {
    case 'admin': return 'Administrator';
    case 'bfp_responder': return 'BFP Responder';
    case 'resident': return 'Resident / Owner';
    default: return role || 'Unknown';
  }
};

type TabType = 'open' | 'resolved';

export const SupportRequests = () => {
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('open');
  const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null);

  const [showResolveModal, setShowResolveModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<SupportRequest | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('support_requests')
      .select(`*, profile:profiles(full_name)`)
      .order('created_at', { ascending: false });

    setLoadError(error ? { message: error.message, code: error.code } : null);

    const formatted = (data || []).map((req: any) => ({
      ...req,
      full_name: req.profile?.full_name || 'Unknown',
    }));
    setRequests(formatted);
    setLoading(false);
  };

  const handleResolve = async () => {
    if (!selectedRequest) return;
    setResolving(true);

    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase
      .from('support_requests')
      .update({
        status: 'resolved',
        admin_notes: adminNotes || null,
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', selectedRequest.id);

    if (error) {
      alert(`Error resolving request: ${error.message}`);
    } else {
      setShowResolveModal(false);
      setSelectedRequest(null);
      setAdminNotes('');
      fetchRequests();
    }

    setResolving(false);
  };

  const openRequests = requests.filter(r => r.status === 'open');
  const resolvedRequests = requests.filter(r => r.status === 'resolved');
  const visibleRequests = activeTab === 'open' ? openRequests : resolvedRequests;

  return (
    <>
      <div className="flex-1 overflow-auto bg-[#FCF9F8] font-['Inter',_sans-serif]">
        <header className="bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] border-b border-[#E5E2E1] p-6 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto">
            <h1 className="text-2xl font-black text-[#231918] tracking-tight">Support Requests</h1>
            <p className="text-[#534341] text-sm mt-1">Requests submitted via "Contact System Administrator"</p>
          </div>
        </header>

        <main className="p-8 max-w-7xl mx-auto">
          {loadError && (
            <div className="mb-6"><LoadErrorBanner what="support requests" error={loadError} onRetry={fetchRequests} /></div>
          )}

          {/* Tabs */}
          <div className="flex space-x-1 bg-white p-1 rounded-lg border border-[#E5E2E1] shadow-sm mb-6 inline-flex">
            <button
              onClick={() => setActiveTab('open')}
              className={`px-6 py-2.5 text-sm font-bold rounded-md transition-colors flex items-center gap-2 ${
                activeTab === 'open'
                  ? 'bg-[#FCF9F8] text-[#D32F2F] shadow-sm'
                  : 'text-[#534341] hover:text-[#231918] hover:bg-gray-50'
              }`}
            >
              Open
              {openRequests.length > 0 && (
                <span className={`px-2 py-0.5 rounded-full text-xs ${activeTab === 'open' ? 'bg-[#D32F2F] text-white' : 'bg-orange-100 text-orange-800'}`}>
                  {openRequests.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('resolved')}
              className={`px-6 py-2.5 text-sm font-bold rounded-md transition-colors ${
                activeTab === 'resolved'
                  ? 'bg-[#FCF9F8] text-[#D32F2F] shadow-sm'
                  : 'text-[#534341] hover:text-[#231918] hover:bg-gray-50'
              }`}
            >
              Resolved
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-[#E5E2E1] overflow-hidden">
            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex justify-center items-center h-64">
                  <Loader2 className="w-8 h-8 text-[#D32F2F] animate-spin" />
                </div>
              ) : (
                <table className="min-w-full divide-y divide-[#E5E2E1]">
                  <thead className="bg-[#FCF9F8]">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Requester</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Category</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Message</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Contact</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">
                        {activeTab === 'open' ? 'Submitted' : 'Resolved'}
                      </th>
                      {activeTab === 'open' ? (
                        <th className="px-6 py-4 text-right text-xs font-bold text-[#534341] uppercase tracking-wider">Actions</th>
                      ) : (
                        <th className="px-6 py-4 text-left text-xs font-bold text-[#534341] uppercase tracking-wider">Resolution Notes</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-[#E5E2E1]">
                    {visibleRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center font-bold shrink-0">
                              {req.full_name.charAt(0)}
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-bold text-[#231918]">{req.full_name}</div>
                              <div className="text-xs text-[#8D7F7D]">{getRoleLabel(req.role_at_request)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border bg-blue-50 text-blue-800 border-blue-200">
                            {req.category}
                          </span>
                        </td>
                        <td className="px-6 py-4 max-w-xs">
                          <p className="text-sm text-[#534341] line-clamp-3">{req.message}</p>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-xs text-[#534341] space-y-1">
                            {req.contact_email && (
                              <div className="flex items-center gap-1"><Mail className="w-3 h-3 text-[#8D7F7D]" />{req.contact_email}</div>
                            )}
                            {req.contact_phone && (
                              <div className="flex items-center gap-1"><Phone className="w-3 h-3 text-[#8D7F7D]" />{req.contact_phone}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-[#8D7F7D]">
                          {formatDate(activeTab === 'open' ? req.created_at : req.reviewed_at)}
                        </td>
                        {activeTab === 'open' ? (
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => {
                                setSelectedRequest(req);
                                setShowResolveModal(true);
                              }}
                              className="text-[#047857] hover:text-[#065F46] bg-[#ECFDF5] px-3 py-1.5 rounded font-bold transition-colors"
                            >
                              Mark Resolved
                            </button>
                          </td>
                        ) : (
                          <td className="px-6 py-4 max-w-xs">
                            <p className="text-sm text-[#534341]">{req.admin_notes || 'No notes'}</p>
                          </td>
                        )}
                      </tr>
                    ))}
                    {visibleRequests.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-[#534341]">
                          <CheckCircle className="mx-auto h-12 w-12 text-gray-300 mb-4" />
                          <p className="font-medium">No {activeTab} support requests</p>
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

      {/* Resolve Modal */}
      {showResolveModal && selectedRequest && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-[#E5E2E1]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-black text-[#231918]">Resolve Request</h3>
              <button onClick={() => setShowResolveModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[#534341] mb-4">
              Resolving <strong>{selectedRequest.category}</strong> request from <strong>{selectedRequest.full_name}</strong>.
            </p>
            <div className="bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg p-3 mb-4 text-sm text-[#534341]">
              {selectedRequest.message}
            </div>

            <textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="e.g. Role changed to BFP Responder, user notified"
              className="w-full px-3 py-2 border border-[#E5E2E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#D32F2F] mb-6 resize-none h-24"
            />

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowResolveModal(false)}
                className="px-4 py-2 border border-[#E5E2E1] text-[#534341] rounded-lg hover:bg-[#FCF9F8] font-bold text-sm transition-colors"
                disabled={resolving}
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={resolving}
                className="px-4 py-2 bg-[#047857] text-white rounded-lg hover:bg-[#065F46] font-bold text-sm transition-colors flex items-center shadow-sm"
              >
                {resolving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Confirm Resolved
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
