import React from 'react';
import { createPortal } from 'react-dom';
import { ShieldAlert, X } from 'lucide-react';

// Shared form, button, pill and dialog styles for admin pages (theme tokens
// from index.css), so Users, Support Requests and Settings look alike.

export const LABEL = 'block text-sm font-bold text-text mb-1';
export const FIELD = 'w-full h-10 px-3 border border-border rounded-lg bg-surface-card text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary';
export const BTN = 'h-10 px-4 rounded-lg font-bold text-sm transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50';
export const BTN_SECONDARY = `${BTN} border border-border text-text-body bg-surface-card hover:bg-surface`;
export const BTN_PRIMARY = `${BTN} bg-primary text-white hover:bg-primary-dark shadow-sm`;
export const BTN_SUCCESS = `${BTN} bg-success-dark text-white hover:bg-[#065F46] shadow-sm`;
// Row-level actions: compact pills on desktop, full-width tap targets on cards.
export const ACTION = 'h-9 px-3 rounded-lg font-bold text-sm transition-colors inline-flex items-center justify-center gap-1.5 flex-1 2xl:flex-none';
export const ACTION_APPROVE = `${ACTION} bg-success/10 text-success-dark hover:bg-success/20`;
export const ACTION_REJECT = `${ACTION} bg-tier2-bg text-primary hover:bg-tier2-bg/70`;
export const ACTION_EDIT = `${ACTION} border border-border text-text-body bg-surface-card hover:bg-surface hover:text-text`;

// No nowrap here: table cells already keep one line, card fields may need to wrap.
export const PILL = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold max-w-full';
export const PILL_OK = `${PILL} bg-success/10 text-success-dark border-success/30`;
export const PILL_WARN = `${PILL} bg-tier1-bg text-tier1-text border-amber-light/40`;
export const PILL_OFF = `${PILL} bg-surface-alt text-text-muted border-border`;

export const Avatar = ({ name }: { name: string }) => (
  <div className="w-10 h-10 shrink-0 rounded-full bg-surface border border-border flex items-center justify-center font-bold text-text-body">
    {name.charAt(0).toUpperCase()}
  </div>
);

export const Identity = ({ name, sub, badge }: { name: string; sub: React.ReactNode; badge?: React.ReactNode }) => (
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

export const ErrorNote = ({ message }: { message: string }) => (
  <div className="mb-4 p-3 bg-tier2-bg text-tier2-text text-sm rounded-lg flex items-start gap-2">
    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
    {message}
  </div>
);

// Bottom sheet on phones, centred dialog from sm up; body scrolls if tall.
// Portalled to <body> so it covers the app header, which sits in a separate
// stacking context from the page content.
export const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => createPortal(
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
export const ModalActions = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3 [&>button]:w-full sm:[&>button]:w-auto">
    {children}
  </div>
);
