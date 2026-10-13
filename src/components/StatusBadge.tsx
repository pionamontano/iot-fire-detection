import { DEVICE_STATUS } from '../lib/deviceStatus';
import type { DeviceStatus } from '../lib/deviceStatus';

// One badge for device status everywhere it appears as a pill.
export const StatusBadge = ({ status }: { status: DeviceStatus }) => {
  const c = DEVICE_STATUS[status];
  return (
    <span className={`${c.badgeBg} px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 whitespace-nowrap`}>
      <span className="w-2 h-2 rounded-full" style={{ background: c.color }}></span>
      <span className={`${c.badgeText} font-bold text-[11px] leading-4 uppercase tracking-[0.08em]`}>{c.label}</span>
    </span>
  );
};

// Compact "3 offline" summary pill in the same palette as StatusBadge.
export const StatusCountPill = ({ status, count }: { status: DeviceStatus; count: number }) => {
  const c = DEVICE_STATUS[status];
  return (
    <span className={`${c.badgeBg} ${c.badgeText} px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 text-[11px] font-bold whitespace-nowrap`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }}></span>
      {count} {c.label.toLowerCase()}
    </span>
  );
};
