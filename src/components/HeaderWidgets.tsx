import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search, Cpu, Settings, LogOut, ArrowRight, Map as MapIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { AlertEvent, Device } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatAge, displayAddress } from '../lib/location';
import { getConnectivityStatus, DEVICE_STATUS } from '../lib/deviceStatus';
import type { DeviceStatus } from '../lib/deviceStatus';

// ─── Shared popover frame ───
// The notification panel and the profile menu use the same frame, header
// and footer so they read as one set (and match the page cards). On phones
// the panel spans the screen width under the top bar instead of hanging
// off the left edge.
const POPOVER =
  'fixed left-3 right-3 top-[72px] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 ' +
  'bg-white rounded-lg border border-border shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-[100] overflow-hidden ' +
  'animate-in fade-in slide-in-from-top-2 duration-200';

const PopoverFooterLink = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    className="w-full px-4 py-3 border-t border-border-warm flex items-center justify-center gap-1 text-xs font-bold text-primary-dark hover:bg-surface transition-colors"
  >
    {children} <ArrowRight className="w-3.5 h-3.5" />
  </button>
);

// Close a popover on outside click or Escape.
const useDismiss = (ref: React.RefObject<HTMLDivElement | null>, close: () => void) => {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, close]);
};

// ═══════════════════════════════════════════
// ─── Notification Dropdown ───
// ═══════════════════════════════════════════
interface NotificationDropdownProps {
  alertsPath: string;
  /** Lowest alert tier listed and counted. BFP responders pass 2: Tier 1 warnings are not dispatched to them. */
  minTier?: 1 | 2;
}

export const NotificationDropdown: React.FC<NotificationDropdownProps> = ({ alertsPath, minTier = 1 }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [alerts, setAlerts] = useState<(AlertEvent & { devices?: { device_code: string; label: string; location_desc: string } })[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // The badge counts every unresolved alert, not just those among the 10
  // most recent shown in the list (which undercounted during busy periods).
  const [unresolvedCount, setUnresolvedCount] = useState(0);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    const [listRes, countRes] = await Promise.all([
      supabase
        .from('alert_events')
        .select('*, devices(device_code, label, location_desc)')
        .gte('alert_tier', minTier)
        .order('triggered_at', { ascending: false })
        .limit(10),
      supabase
        .from('alert_events')
        .select('id', { count: 'exact', head: true })
        .gte('alert_tier', minTier)
        .is('resolved_at', null),
    ]);

    if (!listRes.error && listRes.data) {
      setAlerts(listRes.data as unknown as typeof alerts);
    }
    if (!countRes.error && countRes.count !== null) {
      setUnresolvedCount(countRes.count);
    }
    setLoading(false);
  }, [minTier]);

  useEffect(() => {
    fetchAlerts();

    const channel = supabase.channel('header_notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_events' }, fetchAlerts)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchAlerts]);

  const close = useCallback(() => setIsOpen(false), []);
  useDismiss(dropdownRef, close);
  // Red when a fire (Tier 2) is open, amber when only warnings are.
  const headerTone = DEVICE_STATUS[alerts.some(a => !a.resolved_at && a.alert_tier === 2) ? 'fire' : 'warning'];


  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 shrink-0 hover:bg-white/10 rounded-md transition-colors"
        aria-label={unresolvedCount > 0 ? `Notifications, ${unresolvedCount} active` : 'Notifications'}
        aria-expanded={isOpen}
      >
        <Bell className="w-5 h-5 text-white" />
        {unresolvedCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 bg-white rounded-full flex items-center justify-center shadow-sm">
            <span className="text-primary text-[10px] font-bold leading-none">
              {unresolvedCount > 9 ? '9+' : unresolvedCount}
            </span>
          </span>
        )}
      </button>

      {isOpen && (
        <div className={POPOVER} role="dialog" aria-label="Notifications">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-warm">
            <span className="font-bold text-sm text-text">Notifications</span>
            {unresolvedCount > 0 ? (
              <span className={`${headerTone.badgeBg} ${headerTone.badgeText} px-2 py-0.5 rounded-full text-[11px] font-bold`}>
                {unresolvedCount} active
              </span>
            ) : (
              <span className="text-[11px] font-medium text-text-subtle">No active alerts</span>
            )}
          </div>

          {/* Alert list — unresolved first, then most recent */}
          <div className="max-h-[min(360px,60vh)] overflow-y-auto thin-scroll">
            {loading && alerts.length === 0 ? (
              <div className="p-6 text-center">
                <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin mx-auto" />
                <p className="text-xs text-text-subtle mt-2">Loading…</p>
              </div>
            ) : alerts.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-8 h-8 text-border mx-auto mb-2" />
                <p className="text-sm font-medium text-text">No notifications</p>
                <p className="text-xs text-text-subtle mt-1">You're all caught up.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border-warm">
                {[...alerts].sort((a, b) => Number(!!a.resolved_at) - Number(!!b.resolved_at)).map((alert) => {
                  const deviceInfo = alert.devices as unknown as { device_code: string; label: string; location_desc: string } | undefined;
                  const resolved = !!alert.resolved_at;
                  // Same colors as the status badges: red fire, amber warning.
                  const st = DEVICE_STATUS[alert.alert_tier === 2 ? 'fire' : 'warning'];
                  return (
                    <li key={alert.id}>
                      <button
                        onClick={() => { navigate(alertsPath); setIsOpen(false); }}
                        className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-surface transition-colors ${resolved ? '' : 'bg-surface-warm/60'}`}
                      >
                        <span
                          className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                          style={{ background: resolved ? '#A1A1AA' : st.color }}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-bold text-text">
                              {alert.alert_tier === 2 ? 'Fire alert' : 'Warning'}
                              <span className="font-medium text-text-subtle"> · Tier {alert.alert_tier}</span>
                            </span>
                            <span className="text-[11px] text-text-subtle whitespace-nowrap">{formatAge(alert.triggered_at)}</span>
                          </span>
                          <span className="block text-xs text-text-muted mt-0.5 truncate">
                            <span className="font-mono font-semibold">{deviceInfo?.device_code || 'Unknown device'}</span>
                            {deviceInfo?.label ? ` · ${deviceInfo.label}` : ''}
                          </span>
                          <span className="flex items-center gap-2 mt-1">
                            <span className="text-[11px] text-text-subtle">CO {alert.co_ppm} ppm · {alert.temp_celsius}°C</span>
                            {resolved ? (
                              <span className={`${DEVICE_STATUS.online.badgeBg} ${DEVICE_STATUS.online.badgeText} px-1.5 py-px rounded-full text-[10px] font-bold`}>Resolved</span>
                            ) : (
                              <span className={`${st.badgeBg} ${st.badgeText} px-1.5 py-px rounded-full text-[10px] font-bold`}>Active</span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {alerts.length > 0 && (
            <PopoverFooterLink onClick={() => { navigate(alertsPath); setIsOpen(false); }}>View all alerts</PopoverFooterLink>
          )}
        </div>
      )}
    </div>
  );
};


// ═══════════════════════════════════════════
// ─── Search Bar ───
// ═══════════════════════════════════════════
interface HeaderSearchBarProps {
  /** Page for one picked device (e.g. Device Status filtered to it). */
  resultPath: (device: Device) => string;
  /** Page listing every device matching the typed text. Omit if the portal has none. */
  allResultsPath?: (query: string) => string;
  /** Live Map focused on the device. Omit if the portal has no map page. */
  mapPath?: (device: Device) => string;
}

// Device search in the top bar. Enter opens the highlighted result (the
// first by default) instead of dropping the query on an unrelated page;
// arrow keys move the highlight, Escape closes.
export const HeaderSearchBar: React.FC<HeaderSearchBarProps> = ({ resultPath, allResultsPath, mapPath }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Device[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const term = searchQuery.trim();
    const { data, error } = await supabase
      .from('devices_safe')
      .select('*')
      .or(`device_code.ilike.%${term}%,label.ilike.%${term}%,location_desc.ilike.%${term}%`)
      .limit(5);

    if (!error && data) {
      setResults(data);
      setHighlighted(0);
      setIsOpen(true);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(value), 300);
  };

  const go = (path: string) => {
    navigate(path);
    setIsOpen(false);
    setQuery('');
    setResults([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setIsOpen(true);
      setHighlighted(h => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setHighlighted(h => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      const pick = results[highlighted];
      if (isOpen && pick) go(resultPath(pick));
      else if (query.trim() && allResultsPath) go(allResultsPath(query.trim()));
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const listId = 'header-device-search-results';

  return (
    <div className="hidden md:block relative" ref={searchRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={isOpen && results[highlighted] ? `${listId}-${results[highlighted].id}` : undefined}
        aria-label="Search devices"
        placeholder="Search device ID or location…"
        value={query}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (results.length > 0) setIsOpen(true); }}
        className="bg-surface-alt rounded-md pl-9 pr-4 py-[7px] text-sm text-text placeholder-text-faint w-64 focus:outline-none focus:ring-2 focus:ring-white/30"
      />
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint" />

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-lg border border-border shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {results.length === 0 ? (
            <div className="p-6 text-center">
              <Cpu className="w-6 h-6 text-[#E5E2E1] mx-auto mb-2" />
              <p className="text-xs text-[#5B403D] font-medium">No devices match "{query}"</p>
            </div>
          ) : (
            <ul id={listId} role="listbox" className="max-h-[300px] overflow-y-auto thin-scroll">
              {results.map((device, i) => {
                const connectivity: DeviceStatus = device.is_active ? getConnectivityStatus(device.last_seen_at) : 'disabled';
                const st = DEVICE_STATUS[connectivity];
                return (
                  <li
                    key={device.id}
                    id={`${listId}-${device.id}`}
                    role="option"
                    aria-selected={i === highlighted}
                    onMouseEnter={() => setHighlighted(i)}
                    className={`flex items-center border-b border-[#F0EDEC] last:border-0 ${i === highlighted ? 'bg-[#FCF9F8]' : ''}`}
                  >
                    <button
                      onClick={() => go(resultPath(device))}
                      className="flex-1 min-w-0 text-left px-4 py-3 flex items-center gap-3"
                    >
                      <span className="w-8 h-8 bg-[#F6F3F2] rounded flex items-center justify-center shrink-0">
                        <Cpu className="w-4 h-4 text-primary" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-bold text-[#1C1B1B] truncate">{device.device_code}</span>
                        <span className="block text-[10px] text-[#5B403D] truncate">{device.label} · {displayAddress(device.location_desc)}</span>
                      </span>
                      {/* Connectivity only: alerts aren't loaded here. Same
                          online rule and colors as everywhere else. */}
                      <span title={st.label} className="w-2 h-2 rounded-full shrink-0" style={{ background: st.color }} />
                    </button>
                    {mapPath && (
                      <button
                        onClick={() => go(mapPath(device))}
                        title="Show on map"
                        aria-label={`Show ${device.device_code} on map`}
                        className="p-3 text-[#A1A1AA] hover:text-primary transition-colors shrink-0"
                      >
                        <MapIcon className="w-4 h-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {allResultsPath && results.length > 0 && (
            <button
              onClick={() => go(allResultsPath(query.trim()))}
              className="w-full px-4 py-3 border-t border-border-warm flex items-center justify-center gap-1 text-xs font-bold text-primary-dark hover:bg-surface transition-colors"
            >
              See all devices matching "{query.trim()}" <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};


// ═══════════════════════════════════════════
// ─── User Menu Dropdown ───
// ═══════════════════════════════════════════
interface UserMenuProps {
  settingsPath: string;
  /** Layouts with a logout confirmation pass it here so both entry points behave the same. */
  onSignOut?: () => void;
}

export const UserMenuDropdown: React.FC<UserMenuProps> = ({ settingsPath, onSignOut }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setIsOpen(false), []);
  useDismiss(menuRef, close);

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const roleLabels: Record<string, string> = {
    admin: 'System Administrator',
    bfp_responder: 'BFP Responder',
    resident: 'Resident',
  };

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-sm hover:bg-white/30 transition-colors shrink-0"
        aria-label="User menu"
        aria-expanded={isOpen}
      >
        {profile?.full_name?.charAt(0).toUpperCase() || 'U'}
      </button>

      {isOpen && (
        <div className={POPOVER} role="menu" aria-label="Account">
          {/* Header — same layout as the notifications header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border-warm">
            <span className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white font-bold text-sm shrink-0">
              {profile?.full_name?.charAt(0).toUpperCase() || 'U'}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-text truncate">{profile?.full_name || 'User'}</span>
              <span className="block text-[11px] text-text-subtle truncate">
                {roleLabels[profile?.role || ''] || 'User'}
              </span>
            </span>
          </div>

          {/* Items */}
          <div className="divide-y divide-border-warm">
            <button
              role="menuitem"
              onClick={() => { navigate(settingsPath); setIsOpen(false); }}
              className="w-full text-left px-4 py-3 flex items-center gap-3 text-sm font-medium text-text hover:bg-surface transition-colors"
            >
              <Settings className="w-4 h-4 text-text-subtle" />
              Settings
            </button>
            <button
              role="menuitem"
              onClick={() => { setIsOpen(false); if (onSignOut) onSignOut(); else handleLogout(); }}
              className="w-full text-left px-4 py-3 flex items-center gap-3 text-sm font-medium text-primary hover:bg-surface-warm transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
