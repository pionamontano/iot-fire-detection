import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search, X, Cpu, Settings, LogOut, Flame } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { AlertEvent, Device } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ─── Time Ago Helper ───
const timeAgo = (dateStr: string) => {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

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

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('alert_events')
      .select('*, devices(device_code, label, location_desc)')
      .order('triggered_at', { ascending: false })
      .limit(10);

    if (!error && data) {
      setAlerts(data as unknown as typeof alerts);
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

  const unresolvedCount = alerts.filter(a => !a.resolved_at).length;

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
                return (
                  <button
                    key={alert.id}
                    onClick={() => {
                      navigate(alertsPath);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 border-b border-[#F0EDEC] last:border-0 hover:bg-[#FCF9F8] transition-colors flex items-start gap-3 ${
                      !alert.resolved_at ? 'bg-[#FFF5F2]' : ''
                    }`}
                  >
                    <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      alert.alert_tier === 2 ? 'bg-[#FEE2E2]' : 'bg-[#FEF3C7]'
                    }`}>
                      <Flame className={`w-3.5 h-3.5 ${
                        alert.alert_tier === 2 ? 'text-[#DC2626]' : 'text-[#F59E0B]'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs font-bold ${
                          alert.alert_tier === 2 ? 'text-[#DC2626]' : 'text-[#92400E]'
                        }`}>
                          {alert.alert_tier === 2 ? 'CRITICAL ALERT' : 'WARNING'}
                        </span>
                        <span className="text-[10px] text-[#A1A1AA] whitespace-nowrap">
                          {timeAgo(alert.triggered_at)}
                        </span>
                      </div>
                      <p className="text-xs text-[#1C1B1B] font-medium mt-0.5 truncate">
                        {deviceInfo?.device_code || 'Unknown Device'}
                      </p>
                      <p className="text-[10px] text-[#5B403D] mt-0.5">
                        {alert.temp_celsius}°C · {alert.co_ppm} ppm CO
                        {alert.resolved_at && (
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
              className="w-full px-4 py-2.5 text-center text-xs font-bold text-[#B91C1C] bg-[#F6F3F2] border-t border-[#E5E2E1] hover:bg-[#FEE2E2] transition-colors"
            >
              View All Alerts →
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
  devicesPath: string;
}

export const HeaderSearchBar: React.FC<HeaderSearchBarProps> = ({ devicesPath }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Device[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
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

    setLoading(true);
    const term = searchQuery.trim();
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .or(`device_code.ilike.%${term}%,label.ilike.%${term}%,location_desc.ilike.%${term}%`)
      .limit(5);

    if (!error && data) {
      setResults(data);
      setIsOpen(true);
    }
    setLoading(false);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(value), 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && query.trim()) {
      navigate(devicesPath);
      setIsOpen(false);
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="hidden md:block relative" ref={searchRef}>
      <input
        type="text"
        placeholder="Search devices..."
        value={query}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => query.trim().length >= 2 && results.length > 0 && setIsOpen(true)}
        className="bg-surface-alt rounded-md pl-9 pr-4 py-[7px] text-sm text-text placeholder-text-faint w-64 focus:outline-none focus:ring-2 focus:ring-white/30"
      />
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[10.5px] h-[10.5px] text-text-faint" />

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-[#E5E2E1] z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-4 py-2.5 border-b border-[#E5E2E1] bg-[#F6F3F2]">
            <span className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-[0.1em]">
              {loading ? 'Searching...' : `${results.length} result${results.length !== 1 ? 's' : ''} found`}
            </span>
          </div>

          {results.length === 0 && !loading ? (
            <div className="p-6 text-center">
              <Cpu className="w-6 h-6 text-[#E5E2E1] mx-auto mb-2" />
              <p className="text-xs text-[#5B403D] font-medium">No devices match "{query}"</p>
            </div>
          ) : (
            <div className="max-h-[250px] overflow-y-auto">
              {results.map(device => (
                <button
                  key={device.id}
                  onClick={() => {
                    navigate(devicesPath);
                    setIsOpen(false);
                    setQuery('');
                  }}
                  className="w-full text-left px-4 py-3 border-b border-[#F0EDEC] last:border-0 hover:bg-[#FCF9F8] transition-colors flex items-center gap-3"
                >
                  <div className="w-8 h-8 bg-[#F6F3F2] rounded flex items-center justify-center shrink-0">
                    <Cpu className="w-4 h-4 text-[#B91C1C]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-[#1C1B1B] truncate">{device.device_code}</p>
                    <p className="text-[10px] text-[#5B403D] truncate">{device.label} · {device.location_desc}</p>
                  </div>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${device.is_active ? 'bg-[#10B981]' : 'bg-[#A1A1AA]'}`} />
                </button>
              ))}
            </div>
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
}

export const UserMenuDropdown: React.FC<UserMenuProps> = ({ settingsPath }) => {
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
    <div className="relative hidden md:block" ref={menuRef}>
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
              onClick={handleLogout}
              className="w-full text-left px-4 py-2.5 flex items-center gap-3 text-sm text-[#DC2626] hover:bg-[#FEE2E2] transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="font-medium">Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
