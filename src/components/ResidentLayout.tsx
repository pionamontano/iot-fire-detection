import React from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, BellRing, Settings, LogOut, Menu, X, Cpu, FileText } from 'lucide-react';
import { NotificationDropdown, UserMenuDropdown } from './HeaderWidgets';
import { useAuth } from '../contexts/AuthContext';

export const ResidentLayout = () => {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const [showLogoutModal, setShowLogoutModal] = React.useState(false);

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  const navItems = [
    { name: 'Dashboard', path: '/home', icon: LayoutDashboard },
    { name: 'Alert Settings', path: '/home/settings', icon: BellRing },
    { name: 'Device Registration', path: '/home/devices', icon: Cpu },
    { name: 'System Log', path: '/home/logs', icon: FileText },
  ];

  return (
    <div className="h-screen w-screen bg-[#F4F4F5] flex flex-col font-sans overflow-hidden">
      {/* Top Header */}
      <header className="bg-[#B91C1C] h-16 shadow-sm flex items-center justify-between px-3 lg:px-8 relative z-20 w-full min-w-0">
        <div className="flex items-center gap-2 lg:gap-4 min-w-0 shrink-0">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 text-white/80 hover:text-white rounded-md lg:hidden shrink-0"
          >
            {isSidebarOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-white text-xl sm:text-2xl lg:text-[32px] font-bold tracking-tight whitespace-nowrap" style={{ letterSpacing: '-0.03em' }}>AgapSense</span>
          </div>
        </div>

        {/* Profile & Notifications */}
        <div className="flex items-center gap-2 lg:gap-4 min-w-0 shrink-0">
          <div className="hidden sm:flex items-center text-white text-[10px] sm:text-xs font-bold tracking-[0.1em] uppercase min-w-0">
            <BellRing size={14} className="mr-1.5 sm:mr-3 shrink-0" />
            <span className="truncate max-w-[80px] sm:max-w-[140px] lg:max-w-none">OWNER : {profile?.full_name?.split(' ')[0] || 'USER'}</span>
          </div>

          {/* Notification Bell */}
          <NotificationDropdown alertsPath="/home/settings" />

          {/* User Menu */}
          <UserMenuDropdown settingsPath="/account" />
        </div>
      </header>

      <div className="flex flex-1 relative overflow-hidden">
        {/* Sidebar overlay for mobile */}
        {isSidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-20 lg:hidden backdrop-blur-sm"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar Navigation */}
        <aside className={`
          absolute lg:static inset-y-0 left-0 z-30 w-64 bg-[#FCF9F8] border-r border-[#E5E2E1] flex flex-col h-full
          transform transition-transform duration-300 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          {/* Logo/Brand Area */}
          <div className="px-6 py-8 shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <svg width="20" height="26" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 0C12 0 4 8 4 16C4 20.4183 7.58172 24 12 24C16.4183 24 20 20.4183 20 16C20 8 12 0 12 0Z" fill="#D32F2F"/>
                <path d="M12 12C12 12 8 16 8 20C8 22.2091 9.79086 24 12 24C14.2091 24 16 22.2091 16 20C16 16 12 12 12 12Z" fill="#FF8A65"/>
              </svg>
              <h1 className="text-[#18181B] font-black text-3xl tracking-[-0.03em]">
                AgapSense
              </h1>
            </div>
            <p className="text-[#B91C1C] text-[10px] font-bold tracking-[0.1em] uppercase mt-2">
              Smarter detection, faster response
            </p>
          </div>

          {/* Main Navigation */}
          <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <NavLink
                  key={item.name}
                  to={item.path}
                  className={`
                    flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium
                    ${isActive 
                      ? 'bg-[#FEE2E2] text-[#B91C1C] font-bold' 
                      : 'text-[#52525B] hover:bg-[#F4F4F5]'}
                  `}
                >
                  <item.icon size={18} className={isActive ? 'text-[#B91C1C]' : 'text-[#52525B]'} />
                  {item.name}
                </NavLink>
              );
            })}
          </nav>

          {/* Secondary Navigation */}
          <div className="p-4 border-t border-[#E4E4E7] shrink-0 mt-auto">
            <NavLink
              to="/account"
              className="flex items-center gap-3 px-3 py-2 rounded-md text-[#52525B] hover:bg-[#F4F4F5] transition-colors text-sm font-medium mb-1"
            >
              <Settings size={18} />
              Settings
            </NavLink>
            <button
              onClick={() => setShowLogoutModal(true)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-[#52525B] hover:bg-[#FEE2E2] hover:text-[#DC2626] transition-colors text-sm font-medium"
            >
              <LogOut size={18} />
              Logout
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto h-full p-4 lg:p-8 bg-[#F4F4F5] relative z-0">
          <div className="max-w-6xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-border animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-text-heading mb-2">Confirm Logout</h3>
            <p className="text-sm text-text-body mb-6">Are you sure you want to log out? You will need to log back in to access your dashboard.</p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="px-4 py-2 text-sm font-bold text-text-muted hover:text-text-heading transition-colors"
              >
                CANCEL
              </button>
              <button
                onClick={handleLogout}
                className="px-5 py-2 bg-[#B91C1C] hover:bg-[#991B1B] text-white text-sm font-bold rounded-lg transition-colors shadow-sm"
              >
                LOGOUT
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
