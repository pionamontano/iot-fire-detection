import React, { useState } from 'react';
import { Cpu, Search, AlertCircle } from 'lucide-react';
import type { Device } from '../lib/supabase';
import { FIELD } from './ui';

// Radio-card pickers shared by the admin Users and Support Requests pages.

export type Option = { value: string; title: string; detail?: React.ReactNode; icon?: React.ReactNode };

// Tappable radio cards (replaces a <select> inside forms and modals): shows
// each option's details, not just its name, and works well with touch.
export const OptionList = ({ name, label, value, onChange, options }: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
}) => (
  <div role="radiogroup" aria-label={label} className="grid grid-cols-1 gap-2">
    {options.map(o => {
      const selected = o.value === value;
      return (
        <label
          key={o.value || 'none'}
          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            selected ? 'border-primary bg-surface-warm ring-1 ring-primary' : 'border-border bg-surface-card hover:border-text-faint'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={selected}
            onChange={() => onChange(o.value)}
            className="mt-0.5 accent-[var(--color-primary)] shrink-0"
          />
          {o.icon}
          <span className="min-w-0">
            <span className="block text-sm font-bold text-text">{o.title}</span>
            {o.detail && <span className="block text-xs text-text-warm mt-0.5">{o.detail}</span>}
          </span>
        </label>
      );
    })}
  </div>
);

// Device chooser for the approve/assign modals: a searchable list of the
// unassigned devices, showing code, name and installed location.
export const DevicePicker = ({ name, value, onChange, devices, noneLabel }: {
  name: string;
  value: string;
  onChange: (id: string) => void;
  devices: Device[];
  // When set, a first "skip" option with this title (value '').
  noneLabel?: string;
}) => {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = devices.filter(d =>
    d.id === value || !q || [d.device_code, d.label, d.location_desc].some(f => f?.toLowerCase().includes(q))
  );
  const options: Option[] = [
    ...(noneLabel ? [{ value: '', title: noneLabel, detail: 'You can assign one later from the Users page.' }] : []),
    ...shown.map(d => ({
      value: d.id,
      title: d.device_code,
      detail: [d.label, d.location_desc].filter(Boolean).join(' · ') || undefined,
      icon: <Cpu className="w-4 h-4 mt-0.5 text-primary-dark shrink-0" />,
    })),
  ];
  return (
    <div className="space-y-2">
      {devices.length > 5 && (
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code, name or location"
            aria-label="Search devices"
            className={`${FIELD} pl-9`}
          />
        </div>
      )}
      <div className="max-h-64 overflow-y-auto -mx-1 px-1 py-1">
        <OptionList name={name} label="Device" value={value} onChange={onChange} options={options} />
        {devices.length === 0 ? (
          <p className="text-xs text-amber mt-2 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            No unassigned devices available. Register one under Devices.
          </p>
        ) : shown.length === 0 && (
          <p className="text-xs text-text-warm mt-2">No devices match “{query}”.</p>
        )}
      </div>
    </div>
  );
};

