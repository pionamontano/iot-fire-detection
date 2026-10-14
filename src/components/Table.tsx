import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// One look for every data table in the app (admin, responder and resident),
// so headers, row spacing, hover, empty states and paging match everywhere.
// Pages keep their own cell content; only the frame comes from here.

/** White card the table (and its optional toolbar and pager) sits in. */
export const TABLE_CARD = 'bg-white border border-border rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-hidden';
/** Title + search/filters bar at the top of a table card. */
export const TABLE_TOOLBAR = 'flex flex-wrap items-center justify-between gap-3 p-5 border-b border-border';
export const TABLE_TITLE = 'text-text font-bold text-sm tracking-[0.02em]';
export const TABLE = 'w-full text-sm text-left';
export const THEAD_ROW = 'bg-surface-alt border-b border-border';
export const TH = 'px-5 py-3 text-left text-text-body font-semibold text-[10px] tracking-[0.05em] uppercase whitespace-nowrap';
export const TR = 'border-b border-border last:border-0 hover:bg-surface transition-colors';
export const TD = 'px-5 py-4 align-top';

/** Horizontal scroll wrapper, so wide tables never push the page sideways. */
export const TableScroll = ({ children }: { children: React.ReactNode }) => (
  <div className="overflow-x-auto">{children}</div>
);

/** Single full-width row for "nothing here" messages. */
export const TableEmpty = ({ colSpan, icon, children }: {
  colSpan: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <tr>
    <td colSpan={colSpan} className="text-center px-5 py-14">
      {icon && <div className="flex justify-center mb-3 text-border">{icon}</div>}
      <div className="font-medium text-sm text-text-body">{children}</div>
    </td>
  </tr>
);

/** Footer with the visible range and prev/next; arrows only when there's more than one page. */
export const TablePager = ({ page, pageSize, total, onPageChange }: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) => {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3 text-xs">
      <span className="text-text-faint font-medium">
        Showing {from}–{to} of {total.toLocaleString()}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onPageChange(page - 1)} disabled={page === 1} aria-label="Previous page" className="w-7 h-7 flex items-center justify-center rounded text-text-body hover:bg-surface-alt disabled:opacity-40">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-bold text-text tabular-nums">{page} / {totalPages}</span>
          <button type="button" onClick={() => onPageChange(page + 1)} disabled={page === totalPages} aria-label="Next page" className="w-7 h-7 flex items-center justify-center rounded text-text-body hover:bg-surface-alt disabled:opacity-40">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
