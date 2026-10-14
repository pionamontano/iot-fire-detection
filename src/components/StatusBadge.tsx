import { DEVICE_STATUS } from '../lib/deviceStatus';
import type { DeviceStatus } from '../lib/deviceStatus';
import { alertStatus } from '../lib/alertText';

// One badge for device status everywhere it appears as a pill.
export const StatusBadge = ({ status }: { status: DeviceStatus }) => {
  const c = DEVICE_STATUS[status];
  return (
    <span className={`${c.badgeBg} px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 whitespace-nowrap`}>
      <span className="w-2 h-2 rounded-full" style={{ background: c.badgeDot ?? c.color }}></span>
      <span className={`${c.badgeText} font-bold text-[11px] leading-4 uppercase tracking-[0.08em]`}>{c.label}</span>
    </span>
  );
};

// Compact "3 offline" summary pill in the same palette as StatusBadge.
export const StatusCountPill = ({ status, count }: { status: DeviceStatus; count: number }) => {
  const c = DEVICE_STATUS[status];
  return (
    <span className={`${c.badgeBg} ${c.badgeText} px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 text-[11px] font-bold whitespace-nowrap`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.badgeDot ?? c.color }}></span>
      {count} {c.label.toLowerCase()}
    </span>
  );
};

// Status of one alert row (Active / Acknowledged / Responding / Resolved / False alarm):
// solid red while open, grey once closed.
export const AlertStatusPill = ({ alert }: { alert: Parameters<typeof alertStatus>[0] }) => {
  const { label, open } = alertStatus(alert);
  return (
    <span className={`text-[9px] font-bold px-2 py-1 rounded uppercase whitespace-nowrap ${open ? 'bg-primary text-white' : 'bg-surface-cream text-text-body'}`}>
      {label}
    </span>
  );
};
