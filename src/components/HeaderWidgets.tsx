import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search, X, Cpu, Settings, LogOut, Flame, ArrowRight, Map as MapIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { AlertEvent, Device } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatAge } from '../lib/location';
import { getConnectivityStatus, DEVICE_STATUS } from '../lib/deviceStatus';
import type { DeviceStatus } from '../lib/deviceStatus';

// ═══════════════════════════════════════════
// ─── Notification Dropdown ───
// ═══════════════════════════════════════════
interface NotificationDropdownProps {
  alertsPath: string;
}

export const NotificationDropdown: React.FC<NotificationDropdownProps> = ({ alertsPath }) => {
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
        .order('triggered_at', { ascending: false })
        .limit(10),
      supabase
        .from('alert_events')
        .select('id', { count: 'exact', head: true })
        .is('resolved_at', null),
    ]);

    if (!listRes.error && listRes.data) {
      setAlerts(listRes.data as unknown as typeof alerts);
    }
    if (!countRes.error && countRes.count !== null) {
      setUnresolvedCount(countRes.count);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAlerts();

    const channel = supabase.channel('header_notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_events' }, fetchAlerts)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchAlerts]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 shrink-0 hover:bg-white/10 rounded-md transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5 text-white" />
        {unresolvedCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[18px] h-[18px] bg-red-500 rounded-full border-2 border-[#B91C1C] flex items-center justify-center">
            <span className="text-white text-[9px] font-bold leading-none">
              {unresolvedCount > 9 ? '9+' : unresolvedCount}
            </span>
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-[#E5E2E1] z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E2E1] bg-[#F6F3F2]">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#B91C1C]" />
              <span className="font-bold text-sm text-[#1C1B1B]">Notifications</span>
              {unresolvedCount > 0 && (
                <span className="bg-[#DC2626] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {unresolvedCount}
                </span>
              )}
            </div>
            <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-[#E5E2E1] rounded transition-colors">
              <X className="w-3.5 h-3.5 text-[#A1A1AA]" />
            </button>
          </div>

          {/* Alert List */}
          <div className="max-h-[320px] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center">
                <div className="w-5 h-5 border-2 border-[#E5E2E1] border-t-[#B91C1C] rounded-full animate-spin mx-auto" />
                <p className="text-xs text-[#A1A1AA] mt-2">Loading...</p>
              </div>
            ) : alerts.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-8 h-8 text-[#E5E2E1] mx-auto mb-2" />
                <p className="text-sm font-medium text-[#5B403D]">No notifications</p>
                <p className="text-xs text-[#A1A1AA] mt-1">You're all caught up!</p>
              </div>
            ) : (
              alerts.map((alert) => {
                const deviceInfo = alert.devices as unknown as { device_code: string; label: string; location_desc: string } | undefined;
                const resolved = !!alert.resolved_at;
                return (
                  <button
                    key={alert.id}
                    onClick={() => {
                      navigate(alertsPath);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 border-b border-[#F0EDEC] last:border-0 hover:bg-[#FCF9F8] transition-colors flex items-start gap-3 ${
                      !resolved ? 'bg-[#FFF5F2]' : 'opacity-60'
                    }`}
                  >
                    <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      resolved ? 'bg-[#F0EDEC]' : alert.alert_tier === 2 ? 'bg-[#FEE2E2]' : 'bg-[#FEF3C7]'
                    }`}>
                      <Flame className={`w-3.5 h-3.5 ${
                        resolved ? 'text-[#A1A1AA]' : alert.alert_tier === 2 ? 'text-[#DC2626]' : 'text-[#F59E0B]'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs font-bold ${
                          resolved ? 'text-[#A1A1AA]' : alert.alert_tier === 2 ? 'text-[#DC2626]' : 'text-[#92400E]'
                        }`}>
                          {alert.alert_tier === 2 ? 'Fire alert · Tier 2' : 'Warning · Tier 1'}
                        </span>
                        <span className="text-[10px] text-[#A1A1AA] whitespace-nowrap">
                          {formatAge(alert.triggered_at)}
                        </span>
                      </div>
                      <p className={`text-xs font-medium mt-0.5 truncate ${resolved ? 'text-[#5B403D]' : 'text-[#1C1B1B]'}`}>
                        {deviceInfo?.device_code || 'Unknown Device'}
                      </p>
                      <p className="text-[10px] text-[#5B403D] mt-0.5">
                        {alert.temp_celsius}°C · {alert.co_ppm} ppm CO
                        {resolved && (
                          <span className="text-[#10B981] ml-1 font-bold">· Resolved</span>
                        )}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          {alerts.length > 0 && (
            <button
              onClick={() => {
                navigate(alertsPath);
                setIsOpen(false);
              }}
              className="group w-full px-4 py-3 flex items-center justify-center gap-1.5 text-xs font-bold text-[#B91C1C] bg-[#F6F3F2] border-t border-[#E5E2E1] hover:bg-[#FEE2E2] transition-colors"
            >
              View All Alerts
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </button>
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
  /** Page for one picked device (e.g. System Overview filtered to it). */
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
        <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-[#E5E2E1] z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {results.length === 0 ? (
            <div className="p-6 text-center">
              <Cpu className="w-6 h-6 text-[#E5E2E1] mx-auto mb-2" />
              <p className="text-xs text-[#5B403D] font-medium">No devices match "{query}"</p>
            </div>
          ) : (
            <ul id={listId} role="listbox" className="max-h-[300px] overflow-y-auto">
              {results.map((device, i) => {
                const connectivity: DeviceStatus = device.is_active ? getConnectivityStatus(device.last_seen_at) : 'offline';
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
                        <span className="block text-[10px] text-[#5B403D] truncate">{device.label} · {device.location_desc}</span>
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
              className="w-full px-4 py-2.5 border-t border-[#E5E2E1] bg-[#F6F3F2] text-xs font-bold text-primary hover:bg-[#FEE2E2] transition-colors text-left"
            >
              See all devices matching "{query.trim()}" →
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

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
      >
        {profile?.full_name?.charAt(0).toUpperCase() || 'U'}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-2xl border border-[#E5E2E1] z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {/* User Info */}
          <div className="px-4 py-4 border-b border-[#E5E2E1] bg-[#F6F3F2]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#B91C1C] flex items-center justify-center text-white font-bold text-lg shrink-0">
                {profile?.full_name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#1C1B1B] truncate">{profile?.full_name || 'User'}</p>
                <p className="text-[10px] text-[#5B403D] truncate">
                  {roleLabels[profile?.role || ''] || 'User'}
                </p>
              </div>
            </div>
          </div>

          {/* Menu Items */}
          <div className="py-1">
            <button
              onClick={() => { navigate(settingsPath); setIsOpen(false); }}
              className="w-full text-left px-4 py-2.5 flex items-center gap-3 text-sm text-[#1C1B1B] hover:bg-[#FCF9F8] transition-colors"
            >
              <Settings className="w-4 h-4 text-[#A1A1AA]" />
              <span className="font-medium">Settings</span>
            </button>
            <div className="border-t border-[#F0EDEC]" />
            <button
              onClick={() => { setIsOpen(false); if (onSignOut) onSignOut(); else handleLogout(); }}
              className="w-full text-left px-4 py-2.5 flex items-center gap-3 text-sm text-[#DC2626] hover:bg-[#FEE2E2] transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="font-medium">Log out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
