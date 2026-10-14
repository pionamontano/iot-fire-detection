import React from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, BellRing, Settings, Menu, X, Cpu, History } from 'lucide-react';
import { NotificationDropdown, UserMenuDropdown } from './HeaderWidgets';
import { useAuth } from '../contexts/AuthContext';
import { GlobalErrorBoundary } from './GlobalErrorBoundary';
import { BrandMark } from './BrandMark';

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
    { name: 'Alert History', path: '/home/alerts', icon: History },
    { name: 'Alert Settings', path: '/home/settings', icon: BellRing },
    { name: 'Device Information', path: '/home/devices', icon: Cpu },
  ];

  return (
    <div className="h-screen w-screen bg-surface-alt flex flex-col font-sans overflow-hidden">
      {/* Top Header */}
      <header className="bg-primary h-16 shadow-sm flex items-center justify-between px-3 lg:px-8 relative z-20 w-full min-w-0">
        <div className="flex items-center gap-2 lg:gap-4 min-w-0 shrink-0">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 text-white/80 hover:text-white rounded-md lg:hidden shrink-0"
          >
            {isSidebarOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          
          {/* Brand — shown once, here; the sidebar is navigation only */}
          <BrandMark homePath="/home" />
        </div>

        {/* Profile & Notifications */}
        <div className="flex items-center gap-2 lg:gap-4 min-w-0 shrink-0">
          <div className="hidden sm:flex items-center text-white text-[10px] sm:text-xs font-bold tracking-[0.1em] uppercase min-w-0">
            <span className="truncate max-w-[80px] sm:max-w-[140px] lg:max-w-none">{profile?.full_name?.split(' ')[0] || 'USER'}</span>
          </div>

          {/* Notification Bell */}
          <NotificationDropdown alertsPath="/home/alerts" />

          {/* User Menu */}
          <UserMenuDropdown settingsPath="/account" onSignOut={() => setShowLogoutModal(true)} />
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
          absolute lg:static inset-y-0 left-0 z-30 w-64 bg-surface border-r border-border flex flex-col h-full
          transform transition-transform duration-300 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          {/* Main Navigation */}
          <nav className="flex-1 px-4 pt-6 space-y-1 overflow-y-auto" aria-label="Main">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <NavLink
                  key={item.name}
                  to={item.path}
                  className={`
                    flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium
                    ${isActive 
                      ? 'bg-tier2-bg text-primary font-bold' 
                      : 'text-text-body hover:bg-surface-alt'}
                  `}
                >
                  <item.icon size={18} className={isActive ? 'text-primary' : 'text-text-body'} />
                  {item.name}
                </NavLink>
              );
            })}
          </nav>

          {/* Secondary Navigation */}
          <div className="p-4 border-t border-border shrink-0 mt-auto">
            <NavLink
              to="/account"
              onClick={() => setIsSidebarOpen(false)}
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm ${isActive ? 'bg-tier2-bg text-primary font-bold' : 'text-text-body hover:bg-surface-alt font-medium'}`}
            >
              <Settings size={18} />
              Settings
            </NavLink>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto h-full p-4 lg:p-8 bg-surface-alt relative z-0">
          <div className="max-w-6xl mx-auto">
            <GlobalErrorBoundary>
              <Outlet />
            </GlobalErrorBoundary>
          </div>
        </main>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-border animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-text-heading mb-2">Log out?</h3>
            <p className="text-sm text-text-body mb-6">Are you sure you want to log out? You will need to log back in to access your dashboard.</p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="px-4 py-2 text-sm font-bold text-text-muted hover:text-text-heading transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="px-5 py-2 bg-primary hover:bg-primary-dark text-white text-sm font-bold rounded-lg transition-colors shadow-sm"
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
