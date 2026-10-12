import { MapPin } from 'lucide-react';
import { describeLocation } from '../lib/location';
import type { ResolvedLocation } from '../lib/location';

const TONE: Record<ResolvedLocation['kind'], string> = {
  live: 'border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]',
  last_known: 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]',
  registered: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]',
  unavailable: 'border-[#E5E2E1] bg-[#F4F4F5] text-[#52525B]',
};

// States which kind of position the map shows (live GPS / last-known / registered / unavailable) and when.
export const LocationBadge = ({ location, now }: { location: ResolvedLocation; now?: number }) => {
  const info = describeLocation(location, now);
  return (
    <div role="status" className={`mt-3 flex items-start gap-2 rounded border px-3 py-2 text-[11px] ${TONE[location.kind]}`}>
      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>
        <strong className="font-extrabold uppercase tracking-wide">{info.label}</strong>
        <span className="block font-medium">{info.detail}</span>
      </p>
    </div>
  );
};

// Shown instead of a map when there is no usable position, so no marker is ever placed anywhere made up.
export const LocationUnavailablePanel = ({ heightClass }: { heightClass: string }) => (
  <div className={`${heightClass} flex flex-col items-center justify-center gap-2 rounded border border-dashed border-[#D4D4D8] bg-[#F4F4F5] px-4 text-center text-[#52525B]`}>
    <MapPin className="h-6 w-6 text-[#A1A1AA]" />
    <p className="text-xs font-bold uppercase tracking-wide">Location unavailable</p>
    <p className="text-[11px]">This device has not reported valid GPS coordinates and none are registered.</p>
  </div>
);
