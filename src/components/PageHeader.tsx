import React from 'react';

// One page-title block for every admin and resident page, so titles, descriptions and
// header actions line up and scale the same way at every breakpoint.
export const PageHeader = ({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  eyebrow?: string;
  actions?: React.ReactNode;
}) => (
  <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 md:gap-6">
    <div className="flex flex-col gap-1 min-w-0">
      {eyebrow && (
        <p className="text-primary-dark font-bold text-xs tracking-[0.05em] uppercase">{eyebrow}</p>
      )}
      <h1 className="text-text font-extrabold text-[28px] leading-8 md:text-[40px] md:leading-[44px] tracking-[-0.02em]">
        {title}
      </h1>
      {description && (
        <p className="text-text-body/80 font-medium text-sm leading-5 md:text-base md:leading-6 max-w-2xl">
          {description}
        </p>
      )}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-3 md:gap-4 md:shrink-0">{actions}</div>}
  </header>
);
