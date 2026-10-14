import { useEffect, useState } from 'react';
import { Clock, CheckCircle2, Inbox, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { SupportRequest } from '../lib/supabase';
import { formatDateTime } from '../lib/supportRequests';

const SHOWN = 3;

// The signed-in user's own "Contact Administrator" requests, with their status
// and the administrator's reply. RLS ("Users view own support requests") limits
// the read to their own rows. `refreshKey` changes after they submit a new one.
// `cardClassName` / `titleClassName` let a page match its own card style (the
// resident Account page uses white cards with a normal heading).
export const MySupportRequests = ({ userId, refreshKey, cardClassName, titleClassName }: {
  userId: string;
  refreshKey?: number;
  cardClassName?: string;
  titleClassName?: string;
}) => {
  const [requests, setRequests] = useState<SupportRequest[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from('support_requests')
        .select('id, category, message, status, admin_notes, created_at, reviewed_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setFailed(!!error);
      if (!error) setRequests((data || []) as SupportRequest[]);
    };
    load();
    // Picks up the admin's reply without a reload (when the table is published to Realtime).
    const channel = supabase.channel(`my_support_requests_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_requests', filter: `user_id=eq.${userId}` }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [userId, refreshKey]);

  const visible = showAll ? requests ?? [] : (requests ?? []).slice(0, SHOWN);
  const openCount = (requests ?? []).filter(r => r.status === 'open').length;

  return (
    <div className={cardClassName ?? 'bg-surface-alt border border-border rounded-lg p-6'}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className={titleClassName ?? 'text-xs font-bold uppercase tracking-[0.1em] text-text-body'}>My Requests</h3>
        {openCount > 0 && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-tier1-bg text-tier1-text">{openCount} open</span>
        )}
      </div>

      {failed ? (
        <p className="text-xs text-text-warm">Couldn't load your requests. Try again later.</p>
      ) : requests === null ? (
        <div className="space-y-3">
          {[0, 1].map(i => <div key={i} className="h-14 rounded-md bg-border/50 animate-pulse" />)}
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-3">
          <Inbox className="w-6 h-6 mx-auto text-border mb-2" />
          <p className="text-xs text-text-warm">No requests yet. Use Contact administrator if you need help.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map(r => (
            <li key={r.id} className="bg-surface-card border border-border rounded-md p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-bold text-text-heading">{r.category}</span>
                {r.status === 'open' ? (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-tier1-bg text-tier1-text">
                    <Clock className="w-3 h-3" /> Waiting
                  </span>
                ) : (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/10 text-success-dark">
                    <CheckCircle2 className="w-3 h-3" /> Resolved
                  </span>
                )}
              </div>
              <p className="text-xs text-text-body mt-1 line-clamp-2 break-words" title={r.message}>{r.message}</p>
              <p className="text-[11px] text-text-faint mt-1">
                Sent {formatDateTime(r.created_at)}
                {r.status === 'resolved' && r.reviewed_at && <> · Resolved {formatDateTime(r.reviewed_at)}</>}
              </p>
              {r.status === 'resolved' && r.admin_notes && (
                <div className="mt-2 pt-2 border-t border-border">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint block mb-0.5">Administrator's reply</span>
                  <p className="text-xs text-text whitespace-pre-line break-words">{r.admin_notes}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {requests && requests.length > SHOWN && (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          className="mt-3 w-full inline-flex items-center justify-center gap-1 text-xs font-bold text-text-body hover:text-text"
        >
          {showAll ? <>Show less <ChevronUp className="w-3.5 h-3.5" /></> : <>Show all {requests.length} <ChevronDown className="w-3.5 h-3.5" /></>}
        </button>
      )}
    </div>
  );
};
