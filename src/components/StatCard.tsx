import React from 'react';

// One summary tile for admin pages (Dashboard, System Log). Turns red only
// when `urgent`, so a red "0" never reads as an alarm. With `onClick` it
// becomes a button (e.g. to apply the matching filter); `active` marks the
// tile whose filter is currently applied.
export const StatCard = ({
  label,
  value,
  icon: Icon,
  urgent = false,
  onClick,
  active = false,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  urgent?: boolean;
  onClick?: () => void;
  active?: boolean;
}) => {
  const className = `rounded-lg border shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 sm:p-5 flex flex-col gap-2 min-w-0 text-left ${
    urgent ? 'bg-tier2-bg/60 border-tier2-border/40 border-b-4 border-b-primary-dark' : 'bg-surface-card border-border'
  } ${onClick ? 'transition-colors hover:border-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40' : ''} ${
    active ? 'ring-2 ring-primary/40' : ''
  }`;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={`font-bold text-[10px] leading-[15px] tracking-[0.1em] uppercase ${urgent ? 'text-primary-dark' : 'text-text-body'}`}>
          {label}
        </span>
        <Icon className={`w-4 h-4 sm:w-5 sm:h-5 shrink-0 ${urgent ? 'text-accent' : 'text-text-subtle'}`} />
      </div>
      <span className={`font-extrabold text-[28px] leading-8 sm:text-[36px] sm:leading-10 tracking-[-0.04em] ${urgent ? 'text-primary-dark' : 'text-text'}`}>
        {value}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>{body}</button>
  ) : (
    <div className={className}>{body}</div>
  );
};
