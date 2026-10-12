import { AlertTriangle } from 'lucide-react';

export interface LoadErrorInfo {
  message: string;
  code?: string | null;
}

interface LoadErrorBannerProps {
  /** What failed to load, e.g. "devices". */
  what: string;
  error: LoadErrorInfo;
  onRetry?: () => void;
}

// Shown when a data load FAILS, so a failure (e.g. a permission error) can never be mistaken for a
// genuinely empty list. 42501 is Postgres "insufficient_privilege".
export const LoadErrorBanner = ({ what, error, onRetry }: LoadErrorBannerProps) => (
  <div
    role="alert"
    className="flex items-start gap-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[#991B1B]"
  >
    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
    <div className="min-w-0 flex-1 text-sm">
      <p className="font-bold">Couldn&apos;t load {what}. What you see may be incomplete.</p>
      <p className="mt-1 break-words text-xs">
        {error.code === '42501'
          ? 'The database denied access to a column that was requested (permission error). This is not an empty result.'
          : error.message}
        {error.code ? ` (code ${error.code})` : ''}
      </p>
    </div>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded border border-[#FCA5A5] bg-white px-3 py-1 text-xs font-bold hover:bg-[#FEE2E2]"
      >
        Retry
      </button>
    )}
  </div>
);
