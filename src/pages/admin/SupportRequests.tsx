import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { FilterChips } from '../../components/FilterChips';
import { supabase, realtimeChannel } from '../../lib/supabase';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import { Loader2, CheckCircle, Inbox, Search, Eye, X } from 'lucide-react';
import { TABLE_CARD, TABLE, THEAD_ROW, TH, TR, TD, TablePager, TABLE_PAGE_SIZE } from '../../components/Table';
import { usePagedRows } from '../../hooks/usePagedRows';
import { FIELD, ACTION_APPROVE, ACTION_EDIT, Identity } from '../../components/ui';
import { formatDateTime as formatDate, getRoleLabel } from '../../lib/supportRequests';
import { SupportRequestDialog, CategoryBadge, ContactLines } from './SupportRequestDialog';
import type { SupportRequestRow } from './SupportRequestDialog';

type TabType = 'open' | 'resolved';
type Column = { header: string; cell: (r: SupportRequestRow) => React.ReactNode; wrap?: boolean };

export const SupportRequests = () => {
  const [requests, setRequests] = useState<SupportRequestRow[]>([]);
  const [reviewerNames, setReviewerNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('open');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null);

  // The open dialog lives in the URL (?request=<id>), so a notification or a
  // shared link opens that request, and Back closes the dialog.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('request');
  const selected = selectedId ? requests.find(r => r.id === selectedId) ?? null : null;
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchRequests();
    // New requests show up without a reload (when the table is published to Realtime).
    const channel = realtimeChannel('support_requests_page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_requests' }, () => fetchRequests(false))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchRequests = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    const { data, error } = await supabase
      .from('support_requests')
      .select(`*, profile:profiles(full_name, role, device_id, is_active, telegram_chat_id)`)
      .order('created_at', { ascending: false });

    setLoadError(error ? { message: error.message, code: error.code } : null);

    const formatted: SupportRequestRow[] = (data || []).map((req: any) => ({
      ...req,
      full_name: req.profile?.full_name || 'Unknown user',
      requester: req.profile ? {
        role: req.profile.role,
        device_id: req.profile.device_id,
        is_active: req.profile.is_active,
        telegram_chat_id: req.profile.telegram_chat_id,
      } : null,
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

  const setSelectedId = (id: string | null, replace = false) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (id) next.set('request', id); else next.delete('request');
      return next;
    }, { replace });
  };

  const openDetails = (req: SupportRequestRow) => {
    setNotice(null);
    setSelectedId(req.id);
  };

  const closeDetails = () => setSelectedId(null, true);

  const handleDone = (message: string) => {
    closeDetails();
    setNotice(message);
    fetchRequests(false);
  };

  // Show a linked request on its own tab; tell the admin if the link is stale.
  useEffect(() => {
    if (loading || loadError || !selectedId) return;
    if (selected) {
      setActiveTab(selected.status);
    } else {
      setNotice('That support request no longer exists.');
      closeDetails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selectedId, selected?.status]);

  // Rows and cards open the request like their Resolve / View button.
  const rowProps = (r: SupportRequestRow) => ({
    onClick: () => openDetails(r),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetails(r); }
    },
    tabIndex: 0,
    'aria-label': `${r.status === 'open' ? 'Resolve' : 'View'} ${r.category} request from ${r.full_name}`,
  });

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
          { header: 'Contact', cell: (r: SupportRequestRow) => <ContactLines req={r} /> },
          { header: 'Submitted', cell: (r: SupportRequestRow) => <span className="text-text-warm">{formatDate(r.created_at)}</span> },
        ]
      : [
          {
            header: 'Resolved',
            cell: (r: SupportRequestRow) => (
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
            cell: (r: SupportRequestRow) => r.admin_notes
              ? <p className="text-text line-clamp-2">{r.admin_notes}</p>
              : <span className="text-text-warm italic">No notes</span>,
          },
        ]),
  ];

  // Open requests go straight to the resolve dialog, which also shows the full message.
  const actions = (r: SupportRequestRow) => r.status === 'open' ? (
    <button onClick={(e) => { e.stopPropagation(); openDetails(r); }} className={ACTION_APPROVE}>
      <CheckCircle className="w-4 h-4" />
      Resolve
    </button>
  ) : (
    <button onClick={(e) => { e.stopPropagation(); openDetails(r); }} className={ACTION_EDIT}>
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
          {notice && (
            <div role="status" className="p-3 bg-success/10 border border-success/30 text-success-dark text-sm font-semibold rounded-lg flex items-start gap-2">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1">{notice}</span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss" className="p-0.5 -m-0.5 hover:text-text"><X className="w-4 h-4" /></button>
            </div>
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
                        <tr key={r.id} {...rowProps(r)} className={`${TR} cursor-pointer focus:outline-none focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary`}>
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
                    <li key={r.id} {...rowProps(r)} className="border border-border rounded-lg p-4 flex flex-col gap-4 bg-surface-card cursor-pointer hover:border-text-faint transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
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
        <SupportRequestDialog
          key={selected.id}
          request={selected}
          reviewerName={selected.reviewed_by ? reviewerNames.get(selected.reviewed_by) : undefined}
          onClose={closeDetails}
          onDone={handleDone}
        />
      )}
    </>
  );
};
