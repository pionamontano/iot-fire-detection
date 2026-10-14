import React from 'react';

// ─── Base Skeleton Primitive ───
const Skeleton = ({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`skeleton-pulse rounded ${className}`} {...props} />
);

// ─── Dashboard Skeleton (Admin) ───
// Mimics: 4 stat cards + system status table + sidebar
export const DashboardSkeleton = () => (
  <div className="w-full mx-auto pb-12 animate-fade-in">
    {/* Header */}
    <div className="flex flex-col gap-1 mb-6 md:mb-8">
      <Skeleton className="h-9 w-56 rounded-md" />
      <Skeleton className="h-4 w-full max-w-sm mt-2 rounded" />
    </div>

    {/* 4 Stat Cards */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 mb-6 md:mb-8">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-white border border-border rounded-lg p-4 sm:p-5 flex flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-14 rounded-md" />
        </div>
      ))}
    </div>

    {/* Main Grid */}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
      {/* Map + table area */}
      <div className="lg:col-span-2 flex flex-col gap-6 lg:gap-8">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="w-full rounded-lg h-[280px] sm:h-[360px] lg:h-[420px]" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-40" />
          <div className="bg-white border border-border rounded-lg overflow-hidden">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-4 sm:px-6 py-5 flex items-center gap-4 sm:gap-8 border-b border-border-warm">
                <Skeleton className="h-4 w-16 sm:w-24" />
                <Skeleton className="h-4 w-48 flex-1" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Right column */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-6 w-36 mt-5" />
        <div className="bg-white border border-border rounded-lg">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex gap-3 p-4 border-b border-border-warm">
              <Skeleton className="h-2 w-2 mt-1 rounded-full" />
              <div className="flex-1 flex flex-col gap-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

// ─── Responder Dashboard Skeleton ───
// Mimics: 4 stat cards + map area + live feed + table
export const ResponderDashboardSkeleton = () => (
  <div className="space-y-8 pb-10 animate-fade-in">
    {/* 4 Stat Cards */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-surface-alt border border-border rounded-lg px-5 py-4 flex flex-col gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-16 rounded-md" />
        </div>
      ))}
    </div>

    {/* Map + Live Feed */}
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8">
        <Skeleton className="w-full rounded-lg" style={{ minHeight: 420 }} />
      </div>
      <div className="lg:col-span-4 bg-white border border-border rounded-lg flex flex-col overflow-hidden" style={{ maxHeight: 420 }}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-3 rounded-full" />
        </div>
        <div className="flex-1 p-4 flex flex-col gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex flex-col gap-2 pb-4 border-b border-border last:border-0">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-3 w-44" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-12 rounded" />
                <Skeleton className="h-12 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* Table */}
    <div className="bg-white border border-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-56 rounded" />
      </div>
      <TableRowsSkeleton cols={7} rows={5} />
    </div>
  </div>
);

// ─── Resident Home / Dashboard Skeleton ───
// Mimics: 4 stat cards + telemetry + chart + sidebar
export const ResidentHomeSkeleton = () => (
  <div className="flex flex-col gap-6 pb-12 animate-fade-in">
    {/* Header */}
    <div className="flex flex-wrap justify-between items-end gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-48 rounded-md" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-10 w-28 rounded-lg" />
    </div>

    {/* Status panel */}
    <div className="bg-white border border-border rounded-lg flex flex-col">
      <div className="flex-1 p-5 sm:p-6 flex gap-4">
        <Skeleton className="w-14 h-14 rounded-full shrink-0" />
        <div className="flex-1 flex flex-col gap-3">
          <Skeleton className="h-7 w-40 rounded-md" />
          <Skeleton className="h-4 w-full max-w-lg" />
          <Skeleton className="h-4 w-2/3 max-w-sm" />
        </div>
      </div>
      <div className="grid grid-cols-3 border-t border-border">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="px-4 sm:px-6 py-3 flex flex-col gap-2">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Column */}
      <div className="lg:col-span-2 flex flex-col gap-6">
        {/* Readings */}
        <div className="bg-white rounded-lg border border-border p-5 sm:p-6">
          <Skeleton className="h-5 w-32 mb-2" />
          <Skeleton className="h-3 w-56 mb-5" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="border border-border rounded-lg p-4 flex flex-col gap-3">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-9 w-24 rounded-md" />
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
          <div className="h-44 flex items-end justify-between gap-[2px] ml-12 mt-12">
            {[...Array(24)].map((_, i) => (
              <Skeleton key={i} className="w-full rounded-t" style={{ height: `${30 + ((i * 37) % 40)}%` }} />
            ))}
          </div>
        </div>

        {/* Recent Alerts */}
        <div className="bg-white rounded-lg border border-border overflow-hidden">
          <div className="flex justify-between items-center p-5 border-b border-border-warm">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-3 w-16" />
          </div>
          <TableRowsSkeleton cols={5} rows={3} />
        </div>
      </div>

      {/* Side Column: Notifications, Device Health, Install Location */}
      <div className="lg:col-span-1 flex flex-col gap-6">
        {[3, 3, 1].map((rows, c) => (
          <div key={c} className="bg-white rounded-lg p-5 sm:p-6 border border-border">
            <Skeleton className="h-5 w-36 mb-2" />
            <Skeleton className="h-3 w-32 mb-6" />
            <div className="flex flex-col gap-4">
              {[...Array(rows)].map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ─── Table Rows Skeleton (reusable for any table) ───
export const TableRowsSkeleton = ({ cols = 5, rows = 5 }: { cols?: number; rows?: number }) => (
  <>
    {[...Array(rows)].map((_, rowIdx) => (
      <div key={rowIdx} className="flex items-center px-6 py-4 border-b border-border-warm last:border-0 gap-6">
        {[...Array(cols)].map((_, colIdx) => (
          <Skeleton
            key={colIdx}
            className="h-4 flex-1"
            style={{ maxWidth: colIdx === 0 ? 120 : colIdx === cols - 1 ? 80 : undefined }}
          />
        ))}
      </div>
    ))}
  </>
);

// ─── Table Skeleton inside <tbody> (for inline table loading) ───
export const TableBodySkeleton = ({ cols = 5, rows = 5 }: { cols?: number; rows?: number }) => (
  <>
    {[...Array(rows)].map((_, rowIdx) => (
      <tr key={rowIdx} className="border-b border-border last:border-0">
        {[...Array(cols)].map((_, colIdx) => (
          <td key={colIdx} className="px-5 py-4">
            <Skeleton className={`h-4 ${colIdx === 0 ? 'w-24' : colIdx === cols - 1 ? 'w-16' : 'w-full max-w-[160px]'}`} />
          </td>
        ))}
      </tr>
    ))}
  </>
);

// ─── Card List Skeleton (for device lists, team lists) ───
export const CardListSkeleton = ({ count = 4 }: { count?: number }) => (
  <div className="flex flex-col gap-3 animate-fade-in">
    {[...Array(count)].map((_, i) => (
      <div key={i} className="bg-white border border-border rounded-lg p-5 flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
        <div className="flex-1 flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
    ))}
  </div>
);

// ─── Settings / Form Skeleton ───
export const SettingsFormSkeleton = () => (
  <div className="p-8 space-y-8 animate-fade-in">
    {[...Array(3)].map((_, i) => (
      <div key={i}>
        <Skeleton className="h-3 w-40 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[...Array(3)].map((_, j) => (
            <div key={j} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>
    ))}
    <Skeleton className="h-10 w-32 rounded-lg mt-4" />
  </div>
);

// ─── Full-Page Profile/Account Skeleton ───
export const ProfileSkeleton = () => (
  <div className="flex flex-col gap-8 pb-12 animate-fade-in">
    {/* Header */}
    <div className="flex flex-col gap-2">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-4 w-72 mt-1" />
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Form */}
      <div className="lg:col-span-2 bg-white border border-border rounded-lg p-8">
        <Skeleton className="h-5 w-36 mb-6" />
        <div className="flex flex-col gap-6">
          {[...Array(2)].map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-20 mb-2" />
              <Skeleton className="h-11 w-full rounded-md" />
            </div>
          ))}
          <Skeleton className="h-11 w-full rounded-lg mt-4" />
        </div>
      </div>

      {/* Sidebar */}
      <div className="lg:col-span-1">
        <div className="bg-surface border border-border rounded-lg p-6">
          <Skeleton className="h-3 w-32 mb-4" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 mb-4 last:mb-0">
              <Skeleton className="h-4 w-4 rounded" />
              <div className="flex flex-col gap-1">
                <Skeleton className="h-2 w-20" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

// ─── Resident Device Info Skeleton ───
export const DeviceInfoSkeleton = () => (
  <div className="flex flex-col gap-6 pb-12 animate-fade-in">
    {/* Header */}
    <div className="flex flex-col gap-2">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-8 w-44" />
      <Skeleton className="h-4 w-64 mt-1" />
    </div>

    {/* Map + Info */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Skeleton className="h-64 w-full rounded-lg" />
      <div className="bg-white border border-border rounded-lg p-6 flex flex-col gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-border-warm last:border-0">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>

    {/* Readings */}
    <div className="bg-white border border-border rounded-lg overflow-hidden">
      <div className="p-6 border-b border-border-warm">
        <Skeleton className="h-5 w-40" />
      </div>
      <TableRowsSkeleton cols={4} rows={5} />
    </div>
  </div>
);

// ─── Alert Settings Skeleton ───
export const AlertSettingsSkeleton = () => (
  <div className="flex flex-col gap-6 pb-12 animate-fade-in">
    {/* Header */}
    <div className="flex flex-col gap-2">
      <Skeleton className="h-10 w-56 rounded-md" />
      <Skeleton className="h-4 w-full max-w-md" />
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 flex flex-col gap-6">
        {/* Alert Levels */}
        <div className="bg-white border border-border rounded-lg p-5 sm:p-6">
          <Skeleton className="h-5 w-32 mb-2" />
          <Skeleton className="h-3 w-72 max-w-full mb-8" />
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex flex-col gap-3 mb-8">
              <div className="flex justify-between"><Skeleton className="h-4 w-36" /><Skeleton className="h-7 w-20" /></div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
          <Skeleton className="h-10 w-44 rounded-lg" />
        </div>
        {/* Where Alerts Are Sent */}
        <div className="bg-white border border-border rounded-lg p-5 sm:p-6">
          <Skeleton className="h-5 w-48 mb-2" />
          <Skeleton className="h-3 w-80 max-w-full mb-6" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex justify-between items-start py-4">
              <div className="flex flex-col gap-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-56" /></div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="lg:col-span-1">
        <div className="bg-white border border-border rounded-lg p-5 sm:p-6">
          <Skeleton className="h-4 w-48 mb-2" />
          <Skeleton className="h-3 w-full mb-4" />
          <Skeleton className="h-3 w-36" />
        </div>
      </div>
    </div>
  </div>
);

// ─── Inline Spinner Replacement (for small inline loading) ───
export const InlineLoadingSkeleton = ({ lines = 2, width = 'w-full' }: { lines?: number; width?: string }) => (
  <div className={`flex flex-col gap-2 animate-fade-in ${width}`}>
    {[...Array(lines)].map((_, i) => (
      <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-3/4' : 'w-full'}`} />
    ))}
  </div>
);

// ─── Style wrapper (needed for the Skeleton primitive to accept style prop) ───
// Extended Skeleton with style support
const SkeletonStyled = ({ className = '', style }: { className?: string; style?: React.CSSProperties }) => (
  <div className={`skeleton-pulse rounded ${className}`} style={style} />
);

// Re-export with style support
export { Skeleton, SkeletonStyled };
