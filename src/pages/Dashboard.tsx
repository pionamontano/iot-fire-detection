import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Device, AlertEvent, Profile } from '../lib/supabase';
import { 
  Users, 
  Cpu, 
  Activity, 
  AlertTriangle,
  Settings,
  Loader2
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { DashboardSkeleton } from '../components/SkeletonLoaders';
import { getConnectivityStatus } from '../lib/deviceStatus';
import { useNowTick } from '../hooks/useNowTick';

// Helper to determine device status based on alerts and last_seen_at
const getDeviceStatus = (device: Device, activeAlerts: AlertEvent[], now: number): 'online' | 'reconnecting' | 'alert' | 'offline' => {
  const hasAlert = activeAlerts.some(a => a.device_id === device.id);
  if (hasAlert) return 'alert';
  if (!device.is_active) return 'offline';
  return getConnectivityStatus(device.last_seen_at, now);
};

// Format a number with commas
const formatNumber = (n: number): string => n.toLocaleString();

// Activity log entry type for the snapshot
interface ActivityLogEntry {
  title: string;
  description: string;
  timestamp: string;
  actor: string;
}

export const Dashboard = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<AlertEvent[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [fireEvents24h, setFireEvents24h] = useState(0);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const now = useNowTick();

  useEffect(() => {
    fetchData();

    const deviceSub = supabase.channel('dash_devices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, fetchData)
      .subscribe();

    const alertSub = supabase.channel('dash_alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_events' }, fetchData)
      .subscribe();

    const profileSub = supabase.channel('dash_profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(deviceSub);
      supabase.removeChannel(alertSub);
      supabase.removeChannel(profileSub);
    };
  }, []);

  const fetchData = async () => {
    try {
      const [devicesRes, alertsRes, profilesRes, fireEvents24hRes, recentAlertsRes] = await Promise.all([
        supabase.from('devices').select('*').order('created_at', { ascending: true }),
        supabase.from('alert_events').select('*, devices(*)').is('resolved_at', null),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        // Fire events in last 24 hours
        supabase.from('alert_events')
          .select('id', { count: 'exact', head: true })
          .gte('triggered_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        // Recent resolved alerts for activity snapshot
        supabase.from('alert_events')
          .select('*, devices(label, device_code)')
          .order('triggered_at', { ascending: false })
          .limit(5)
      ]);

      if (devicesRes.data) setDevices(devicesRes.data);
      if (alertsRes.data) setActiveAlerts(alertsRes.data as unknown as AlertEvent[]);
      if (profilesRes.count !== null) setTotalUsers(profilesRes.count);
      if (fireEvents24hRes.count !== null) setFireEvents24h(fireEvents24hRes.count);

      // Build activity logs from recent alert events
      if (recentAlertsRes.data && recentAlertsRes.data.length > 0) {
        const logs: ActivityLogEntry[] = recentAlertsRes.data.map((alert: any) => {
          const deviceLabel = alert.devices?.label || alert.devices?.device_code || 'Unknown Device';
          const isResolved = !!alert.resolved_at;
          return {
            title: isResolved ? 'Alert Resolved' : `Tier ${alert.alert_tier} Alert Triggered`,
            description: isResolved
              ? `Alert on ${deviceLabel} was resolved. CO: ${alert.co_ppm}ppm, Temp: ${alert.temp_celsius}°C.`
              : `${deviceLabel} triggered a Tier ${alert.alert_tier} alert. CO: ${alert.co_ppm}ppm, Temp: ${alert.temp_celsius}°C.`,
            timestamp: new Date(alert.triggered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            actor: isResolved ? 'System' : 'Automated'
          };
        });
        setActivityLogs(logs);
      } else {
        setActivityLogs([]);
      }
    } catch (error) {
      console.error('Error fetching dashboard data', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="w-full mx-auto pb-[63px]">
      
      {/* Top Header Area */}
      <div className="flex flex-col gap-1 mb-10 pl-[30px]">
        <h2 className="text-[#1C1B1B] font-extrabold text-[40px] leading-[36px] tracking-[-0.0187em]">
          Dashboard
        </h2>
        <p className="text-[#5B403D]/70 font-medium text-sm leading-5 mt-1 max-w-[809px]">
          Monitor overall system status and gain a real-time summary of users, devices, and fire alerts across the IoT network.
        </p>
      </div>

      {/* 4 Stat Cards — all from real data */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <StatCard
          label="Total Users"
          value={formatNumber(totalUsers)}
          icon={<Users className="w-5 h-5 text-[#1C1B1B]" />}
        />
        <StatCard
          label="Registered Devices"
          value={formatNumber(devices.length)}
          icon={<Cpu className="w-5 h-5 text-[#1C1B1B]" />}
        />
        <UrgentStatCard
          label="Active Alarms"
          value={String(activeAlerts.length).padStart(2, '0')}
          icon={<AlertTriangle className="w-[22px] h-[19px] text-[#D32F2F]" />}
        />
        <StatCard
          label="Total Fire Events (24hrs)"
          value={String(fireEvents24h).padStart(3, '0')}
          icon={<Activity className="w-4 h-[19px] text-[#1C1B1B]" />}
        />
      </div>

      {/* Main Dashboard Layout (Grid 3 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 mb-10">
        
        {/* System Status Table (Col span 2) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h3 className="text-[#1C1B1B] font-bold text-[20px] leading-7 tracking-[-0.025em]">
              System Status Overview
            </h3>
            <Link 
              to="/admin/devices"
              className="text-[#AF101A] font-bold text-[12px] leading-4 text-center hover:underline"
            >
              View All Sensors
            </Link>
          </div>

          <div className="bg-[#F6F3F2] rounded-[8px] shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-hidden flex flex-col">
            
            {/* Table Header */}
            <div className="flex bg-[#EBE7E7] border-b border-[#F4F4F5]">
              <div className="w-[165px] px-6 py-4 text-[#5B403D] font-black text-[10px] uppercase tracking-[0.1em]">
                Device UID
              </div>
              <div className="flex-1 px-6 py-4 text-[#5B403D] font-black text-[10px] uppercase tracking-[0.1em]">
                Location
              </div>
              <div className="w-[191px] px-6 py-4 text-[#5B403D] font-black text-[10px] uppercase tracking-[0.1em] text-right">
                Status
              </div>
            </div>

            {/* Table Body — from real DB data */}
            <div className="flex flex-col bg-white">
              {devices.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-[#A1A1AA] text-sm">
                  <div className="flex flex-col items-center gap-2">
                    <Cpu className="w-8 h-8 text-[#E4E4E7]" />
                    <span>No devices registered yet</span>
                    <Link to="/admin/devices" className="text-[#AF101A] font-bold text-[12px] hover:underline mt-1">
                      Register your first device →
                    </Link>
                  </div>
                </div>
              ) : (
                devices.slice(0, 6).map((device) => {
                  const status = getDeviceStatus(device, activeAlerts, now);
                  const isAlert = status === 'alert';

                  return (
                    <div 
                      key={device.id}
                      className={`flex border-b border-[#F4F4F5] hover:bg-gray-50 transition-colors ${isAlert ? 'bg-[#F4A185]/10' : ''}`}
                    >
                      <div className="w-[165px] px-6 py-[22px]">
                        <span className={`text-[#1C1B1B] font-mono text-[12px] leading-4 ${isAlert ? 'font-bold' : ''}`}>
                          {device.device_code}
                        </span>
                      </div>
                      <div className="flex-1 px-6 py-5 flex items-center">
                        <span className={`text-[#52525B] font-medium text-[14px] leading-5 ${isAlert ? 'font-bold' : ''}`}>
                          {device.location_desc}
                        </span>
                      </div>
                      <div className="w-[191px] px-6 py-5 flex items-center justify-end">
                        <StatusBadge status={status} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Content (Col span 1) */}
        <div className="flex flex-col gap-6">
          
          {/* Quick Actions */}
          <div className="flex flex-col gap-4">
            <h3 className="text-[#A1A1AA] font-bold text-[14px] uppercase tracking-[0.1em]">
              Quick Actions
            </h3>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => navigate('/admin/users')}
                className="bg-[#B91C1C] rounded-[8px] p-4 flex items-center justify-between text-white hover:bg-[#AF101A] transition-colors"
              >
                <span className="font-semibold text-[14px] leading-5">Add User</span>
                <Users className="w-4 h-4" />
              </button>
              <button 
                onClick={() => navigate('/admin/devices')}
                className="border-2 border-[#AF101A] rounded-[8px] p-4 flex items-center justify-between text-[#3F3F46] hover:bg-[#FFF5F2] transition-colors"
              >
                <span className="font-semibold text-[14px] leading-5">Register Device</span>
                <Settings className="w-5 h-5 text-[#1C1B1B]" />
              </button>
            </div>
          </div>

          {/* Activity Snapshot — from real DB data */}
          <div className="flex flex-col gap-6 mt-2">
            <div className="flex items-center gap-2">
              <h3 className="text-[#A1A1AA] font-bold text-[14px] uppercase tracking-[0.1em]">
                Activity Snapshot
              </h3>
            </div>

            <div className="flex flex-col gap-4">
              {activityLogs.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-[#A1A1AA] text-[12px]">
                  <Activity className="w-6 h-6 text-[#E4E4E7] mb-2" />
                  <span>No recent activity</span>
                </div>
              ) : (
                activityLogs.map((log, index) => (
                  <div key={index} className="flex gap-4">
                    <div className="w-[3px] bg-[#E4E4E7] rounded-full shrink-0"></div>
                    <div className="flex flex-col gap-1 py-1">
                      <h4 className="text-[#1C1B1B] font-bold text-[12px] leading-4">{log.title}</h4>
                      <p className="text-[#71717A] text-[11px] leading-[16.5px]">{log.description}</p>
                      <span className="text-[#A1A1AA] font-black text-[10px] tracking-[-0.05em] uppercase mt-1">
                        {log.timestamp} • {log.actor}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Visualization Section */}
      <div className="relative rounded-[16px] bg-[#18181B] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] overflow-hidden">
        {/* Background Heatmap Image */}
        <div 
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage: "url('/heatmap_bg.png')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
        ></div>

        <div className="relative z-10 p-8 flex items-center justify-between">
          <div className="flex flex-col gap-2">
            <h3 className="text-white font-black text-[24px] leading-8 tracking-[-0.05em]">
              Thermal Clarity View
            </h3>
            <p className="text-[#A1A1AA] font-normal text-[14px] leading-5 max-w-[428px]">
              Real-time heatmap visualization of industrial campus. Dark areas indicate optimal temperatures below 24°C.
            </p>
          </div>
          
          <button 
            onClick={() => navigate('/admin/map')}
            className="bg-[#AF101A] hover:bg-[#8F0C14] text-white px-6 py-3 rounded-[4px] font-bold text-[12px] leading-4 tracking-[0.1em] uppercase transition-colors"
          >
            Enter Interactive Map
          </button>
        </div>
      </div>

    </div>
  );
};

// Status Badge component
const StatusBadge = ({ status }: { status: 'online' | 'reconnecting' | 'alert' | 'offline' }) => {
  const config = {
    online: {
      bg: 'bg-[#00799C]/10',
      dot: 'bg-[#10B981]',
      text: 'text-[#00799C]',
      label: 'Online'
    },
    reconnecting: {
      bg: 'bg-[#FEF3C7]/60',
      dot: 'bg-[#F59E0B]',
      text: 'text-[#B45309]',
      label: 'Reconnecting'
    },
    alert: {
      bg: 'bg-[#FFDAD6]/20',
      dot: 'bg-[#DC2626]',
      text: 'text-[#DC2626]',
      label: 'Alert'
    },
    offline: {
      bg: 'bg-[#EBE7E7]',
      dot: 'bg-[#71717A]',
      text: 'text-[#71717A]',
      label: 'Offline'
    }
  };

  const c = config[status];

  return (
    <div className={`${c.bg} px-3 py-1 rounded-[12px] flex items-center gap-2`}>
      <span className={`w-2 h-2 rounded-full ${c.dot}`}></span>
      <span className={`${c.text} font-bold text-[14px] leading-5 uppercase tracking-[0.1em]`}>{c.label}</span>
    </div>
  );
};

// Simple Stat Card
const StatCard = ({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) => (
  <div className="bg-[#F6F3F2] border-b-2 border-transparent rounded-[8px] p-6 flex flex-col gap-2">
    <span className="text-[#5B403D] font-bold text-[10px] leading-[15px] tracking-[0.1em] uppercase">
      {label}
    </span>
    <div className="flex items-end justify-between">
      <span className="font-extrabold text-[36px] leading-[40px] tracking-[-0.05em] text-[#1C1B1B]">
        {value}
      </span>
      <div className="pb-1">{icon}</div>
    </div>
  </div>
);

// Urgent Stat Card (Red theme)
const UrgentStatCard = ({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) => (
  <div className="bg-[#F4A185]/20 border-b-4 border-[#AF101A] rounded-[8px] p-6 flex flex-col gap-2 relative overflow-hidden">
    <span className="text-[#AF101A] font-bold text-[10px] leading-[15px] tracking-[0.1em] uppercase relative z-10">
      {label}
    </span>
    <div className="flex items-end justify-between relative z-10">
      <span className="font-extrabold text-[36px] leading-[40px] tracking-[-0.05em] text-[#AF101A]">
        {value}
      </span>
      <div className="pb-1">{icon}</div>
    </div>
  </div>
);