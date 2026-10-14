import React, { useState, useEffect } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { FilterChips } from '../../components/FilterChips';
import { supabase } from '../../lib/supabase';
import type { SupportRequest } from '../../lib/supabase';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import { Loader2, CheckCircle, Inbox, Mail, Phone, Search, Eye, RotateCcw } from 'lucide-react';
import { TABLE_CARD, TABLE, THEAD_ROW, TH, TR, TD, TablePager, TABLE_PAGE_SIZE } from '../../components/Table';
import { usePagedRows } from '../../hooks/usePagedRows';
import {
  LABEL, FIELD, BTN_SECONDARY, BTN_PRIMARY, BTN_SUCCESS, ACTION_APPROVE, ACTION_EDIT,
  PILL, Identity, ErrorNote, Modal, ModalActions,
} from '../../components/ui';

const EMPTY = '—';
const Empty = () => <span className="text-text-warm">{EMPTY}</span>;

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return EMPTY;
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
    default: return role || 'Unknown role';
  }
};

// Same categories as AdminSupportModal's picker; anything else falls back to grey.
const CATEGORY_BADGE: Record<string, string> = {
  'Role Change': 'bg-blue-100 text-blue-800 border-blue-200',
  'Password Reset': 'bg-purple-100 text-purple-800 border-purple-200',
  'Station Assignment': 'bg-green-100 text-green-800 border-green-200',
  'Account Access / Permissions': 'bg-amber-100 text-amber-800 border-amber-200',
};

const CategoryBadge = ({ category }: { category: string }) => (
  <span className={`${PILL} font-semibold ${CATEGORY_BADGE[category] ?? 'bg-gray-100 text-gray-800 border-gray-200'}`}>
    {category}
  </span>
);

const ContactLines = ({ req }: { req: SupportRequest }) => {
  if (!req.contact_email && !req.contact_phone) return <Empty />;
  return (
    <div className="space-y-1 text-text-body">
      {req.contact_email && (
        <a href={`mailto:${req.contact_email}`} className="flex items-center gap-1.5 hover:text-primary break-all">
          <Mail className="w-3.5 h-3.5 shrink-0 text-text-faint" />{req.contact_email}
        </a>
      )}
      {req.contact_phone && (
        <a href={`tel:${req.contact_phone}`} className="flex items-center gap-1.5 hover:text-primary">
          <Phone className="w-3.5 h-3.5 shrink-0 text-text-faint" />{req.contact_phone}
        </a>
      )}
    </div>
  );
};

type TabType = 'open' | 'resolved';
type Column = { header: string; cell: (r: SupportRequest) => React.ReactNode; wrap?: boolean };

export const SupportRequests = () => {
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [reviewerNames, setReviewerNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('open');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null);

  const [selected, setSelected] = useState<SupportRequest | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchRequests();
    // New requests show up without a reload (when the table is published to Realtime).
    const channel = supabase.channel('support_requests_page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_requests' }, () => fetchRequests(false))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchRequests = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    const { data, error } = await supabase
      .from('support_requests')
      .select(`*, profile:profiles(full_name)`)
      .order('created_at', { ascending: false });

    setLoadError(error ? { message: error.message, code: error.code } : null);

    const formatted: SupportRequest[] = (data || []).map((req: any) => ({
      ...req,
      full_name: req.profile?.full_name || 'Unknown user',
    }));
    setRequests(formatted);

    // reviewed_by points at auth.users, so it can't be embedded; look the names up separately.
    const reviewerIds = [...new Set(formatted.map(r => r.reviewed_by).filter((id): id is string => !!id))];
    if (reviewerIds.length > 0) {
      const { data: reviewers } = await supabase.from('profiles').select('id, full_name').in('id', reviewerIds);
      setReviewerNames(new Map((reviewers || []).map(p => [p.id, p.full_name])));
    }
    setLoading(false);
  };

  const openDetails = (req: SupportRequest) => {
    setSelected(req);
    setAdminNotes(req.admin_notes ?? '');
    setActionError(null);
  };

  const closeDetails = () => {
    if (saving) return;
    setSelected(null);
    setAdminNotes('');
    setActionError(null);
  };

  const updateStatus = async (status: SupportRequest['status']) => {
    if (!selected) return;
    setSaving(true);
    setActionError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('support_requests')
      .update(status === 'resolved'
        ? { status, admin_notes: adminNotes.trim() || null, reviewed_by: user?.id, reviewed_at: new Date().toISOString() }
        : { status, reviewed_by: null, reviewed_at: null })
      .eq('id', selected.id);

    setSaving(false);
    if (error) {
      setActionError(`Couldn't update this request: ${error.message}`);
      return;
    }
    setSelected(null);
    setAdminNotes('');
    fetchRequests(false);
  };

  const switchTab = (tab: TabType) => {
    setActiveTab(tab);
    setCategoryFilter('all');
  };

  const term = searchTerm.trim().toLowerCase();
  const openCount = requests.filter(r => r.status === 'open').length;
  const searched = requests.filter(r => r.status === activeTab && (
    !term
    || r.full_name.toLowerCase().includes(term)
    || r.message.toLowerCase().includes(term)
    || (r.contact_email ?? '').toLowerCase().includes(term)
    || (r.contact_phone ?? '').includes(term)
  ));
  const visible = categoryFilter === 'all' ? searched : searched.filter(r => r.category === categoryFilter);
  const categories = [...new Set(requests.filter(r => r.status === activeTab).map(r => r.category))].sort();
  const CATEGORY_FILTERS = [
    { value: 'all', label: 'All', count: searched.length },
    ...categories.map(c => ({ value: c, label: c, count: searched.filter(r => r.category === c).length })),
  ];
  const { page, setPage, pageRows } = usePagedRows(visible, `${activeTab}|${term}|${categoryFilter}`);

  const TABS: { id: TabType; label: string; count?: number }[] = [
    { id: 'open', label: 'Open', count: openCount },
    { id: 'resolved', label: 'Resolved' },
  ];

  const identity: Column = {
    header: 'Requester',
    cell: (r) => <Identity name={r.full_name} sub={getRoleLabel(r.role_at_request)} />,
  };
  const columns: Column[] = [
    { header: 'Category', cell: (r) => <CategoryBadge category={r.category} /> },
    {
      header: 'Message',
      wrap: true,
      cell: (r) => <p className="text-text-body line-clamp-2 whitespace-pre-line" title={r.message}>{r.message}</p>,
    },
    ...(activeTab === 'open'
      ? [
          { header: 'Contact', cell: (r: SupportRequest) => <ContactLines req={r} /> },
          { header: 'Submitted', cell: (r: SupportRequest) => <span className="text-text-warm">{formatDate(r.created_at)}</span> },
        ]
      : [
          {
            header: 'Resolved',
            cell: (r: SupportRequest) => (
              <>
                <div className="text-text-warm">{formatDate(r.reviewed_at)}</div>
                {r.reviewed_by && reviewerNames.get(r.reviewed_by) && (
                  <div className="text-xs text-text-faint mt-0.5">by {reviewerNames.get(r.reviewed_by)}</div>
                )}
              </>
            ),
          },
          {
            header: 'Resolution Notes',
            wrap: true,
            cell: (r: SupportRequest) => r.admin_notes
              ? <p className="text-text line-clamp-2">{r.admin_notes}</p>
              : <span className="text-text-warm italic">No notes</span>,
          },
        ]),
  ];

  // Open requests go straight to the resolve dialog, which also shows the full message.
  const actions = (r: SupportRequest) => r.status === 'open' ? (
    <button onClick={() => openDetails(r)} className={ACTION_APPROVE}>
      <CheckCircle className="w-4 h-4" />
      Resolve
    </button>
  ) : (
    <button onClick={() => openDetails(r)} className={ACTION_EDIT}>
      <Eye className="w-4 h-4" />
      View
    </button>
  );

  const filtered = !!term || categoryFilter !== 'all';
  const emptyState = (
    <div className="px-5 py-14 text-center font-medium text-sm text-text-body">
      {activeTab === 'open'
        ? <Inbox className="mx-auto h-12 w-12 text-border mb-4" />
        : <CheckCircle className="mx-auto h-12 w-12 text-border mb-4" />}
      <p className="font-medium">{filtered ? 'Nothing matches your search' : `No ${activeTab} support requests`}</p>
    </div>
  );

  return (
    <>
      <div className="space-y-6 md:space-y-8">
        <PageHeader
          title="Support Requests"
          description={<>Requests submitted via &ldquo;Contact System Administrator&rdquo;.</>}
        />

        <div className="space-y-4 md:space-y-6">
          {loadError && (
            <LoadErrorBanner what="support requests" error={loadError} onRetry={() => fetchRequests()} />
          )}

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
                {tab.label}
                {!!tab.count && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-primary text-white">{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          <div className={TABLE_CARD}>
            <div className="p-3 sm:p-5 border-b border-border flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="relative w-full lg:max-w-sm shrink-0">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
                <input
                  type="search"
                  placeholder="Search name, message, email or phone"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Search"
                  className={`${FIELD} pl-9`}
                />
              </div>
              {categories.length > 1 && (
                <FilterChips label="Filter by category" value={categoryFilter} onChange={setCategoryFilter} options={CATEGORY_FILTERS} />
              )}
            </div>

            {loading ? (
              <div className="flex justify-center items-center h-64">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : visible.length === 0 ? emptyState : (
              <>
                {/* Table from 2xl up (where the sidebar leaves room), labelled cards below — same as Users. */}
                <div className="hidden 2xl:block overflow-x-auto">
                  <table className={TABLE}>
                    <thead>
                      <tr className={THEAD_ROW}>
                        {[identity, ...columns].map(c => <th key={c.header} className={TH}>{c.header}</th>)}
                        <th className={`${TH} !text-right`}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map(r => (
                        <tr key={r.id} className={TR}>
                          {[identity, ...columns].map(c => (
                            <td key={c.header} className={`${TD} text-text ${c.wrap ? 'max-w-xs' : 'whitespace-nowrap'}`}>{c.cell(r)}</td>
                          ))}
                          <td className={`${TD} whitespace-nowrap text-right`}>
                            <div className="inline-flex items-center gap-2">{actions(r)}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ul className="2xl:hidden grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 sm:p-4">
                  {pageRows.map(r => (
                    <li key={r.id} className="border border-border rounded-lg p-4 flex flex-col gap-4 bg-surface-card">
                      {identity.cell(r)}
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {columns.map(c => (
                          <div key={c.header} className={`min-w-0 ${c.wrap ? 'col-span-2' : ''}`}>
                            <dt className="text-text-body font-black text-[10px] uppercase tracking-[0.1em] mb-1">{c.header}</dt>
                            <dd className="text-sm text-text break-words">{c.cell(r)}</dd>
                          </div>
                        ))}
                      </dl>
                      <div className="flex gap-2 pt-3 border-t border-border-warm">{actions(r)}</div>
                    </li>
                  ))}
                </ul>
                <TablePager page={page} pageSize={TABLE_PAGE_SIZE} total={visible.length} onPageChange={setPage} />
              </>
            )}
          </div>
        </div>
      </div>

      {selected && (
        <Modal title={selected.status === 'open' ? 'Resolve Request' : 'Support Request'} onClose={closeDetails}>
          {actionError && <ErrorNote message={actionError} />}

          <Identity name={selected.full_name} sub={getRoleLabel(selected.role_at_request)} />

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-text-body font-black text-[10px] uppercase tracking-[0.1em] mb-1">Category</dt>
              <dd><CategoryBadge category={selected.category} /></dd>
            </div>
            <div>
              <dt className="text-text-body font-black text-[10px] uppercase tracking-[0.1em] mb-1">Submitted</dt>
              <dd className="text-text-warm">{formatDate(selected.created_at)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-text-body font-black text-[10px] uppercase tracking-[0.1em] mb-1">Contact</dt>
              <dd><ContactLines req={selected} /></dd>
            </div>
          </dl>

          <p className={`${LABEL} mt-5`}>Message</p>
          <div className="bg-surface border border-border rounded-lg p-3 text-sm text-text whitespace-pre-line break-words">
            {selected.message}
          </div>

          {selected.status === 'open' ? (
            <>
              <label htmlFor="resolution-notes" className={`${LABEL} mt-5`}>
                Resolution notes <span className="font-medium text-text-warm">(optional)</span>
              </label>
              <textarea
                id="resolution-notes"
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="e.g. Role changed to BFP Responder, user notified"
                className={`${FIELD} h-24 py-2 resize-none`}
              />
              <ModalActions>
                <button onClick={closeDetails} disabled={saving} className={BTN_SECONDARY}>Cancel</button>
                <button onClick={() => updateStatus('resolved')} disabled={saving} className={BTN_SUCCESS}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Mark Resolved
                </button>
              </ModalActions>
            </>
          ) : (
            <>
              <p className={`${LABEL} mt-5`}>Resolution</p>
              <p className="text-sm text-text-warm">
                {formatDate(selected.reviewed_at)}
                {selected.reviewed_by && reviewerNames.get(selected.reviewed_by) && <> by {reviewerNames.get(selected.reviewed_by)}</>}
              </p>
              <p className="text-sm text-text mt-1 whitespace-pre-line">
                {selected.admin_notes || <span className="text-text-warm italic">No notes</span>}
              </p>
              <ModalActions>
                <button onClick={() => updateStatus('open')} disabled={saving} className={BTN_SECONDARY}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Reopen
                </button>
                <button onClick={closeDetails} disabled={saving} className={BTN_PRIMARY}>Done</button>
              </ModalActions>
            </>
          )}
        </Modal>
      )}
    </>
  );
};
