import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FileText, Settings, Menu, X } from 'lucide-react';
import { NotificationDropdown, HeaderSearchBar, UserMenuDropdown } from './HeaderWidgets';
import { useAuth } from '../contexts/AuthContext';
import { GlobalErrorBoundary } from './GlobalErrorBoundary';
import { BrandMark } from './BrandMark';
import { ResponderAlarm } from './ResponderAlarm';

export const ResponderLayout: React.FC = () => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [showLogoutModal, setShowLogoutModal] = React.useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const mainNavItems = [
    { name: 'Dashboard', path: '/responder', icon: LayoutDashboard },
    { name: 'Alert Logs', path: '/responder/alerts', icon: FileText },
  ];

  const secondaryNavItems = [
    { name: 'Settings', path: '/responder/settings', icon: Settings },
  ];

  return (
    <div className="h-screen w-screen bg-surface font-sans flex flex-col overflow-hidden">
      
      {/* ─── Top Navigation Bar ─── */}
      <header className="shrink-0 h-[69px] z-50 bg-primary flex items-center justify-between px-3 md:px-8 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        {/* Brand — shown once, here; the sidebar is navigation only */}
        <BrandMark homePath="/responder" />

        {/* Right Section */}
        <div className="flex items-center gap-3 md:gap-6">
          {/* Search */}
          <HeaderSearchBar resultPath={(d) => `/responder/alerts?device=${encodeURIComponent(d.device_code)}`} />

          {/* Notification Bell */}
          <NotificationDropdown alertsPath="/responder/alerts" minTier={2} />

          {/* User Menu */}
          <UserMenuDropdown settingsPath="/responder/settings" onSignOut={() => setShowLogoutModal(true)} />

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-1 text-white shrink-0"
            aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </header>

      {/* ─── Body (below top nav) ─── */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* ─── Sidebar ─── */}
        <aside className={`
          absolute md:static inset-y-0 left-0 z-40
          w-64 bg-surface-warm border-r border-border-light
          flex flex-col justify-between h-full
          transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
        `}>
          <div className="flex flex-col flex-1 pt-6 overflow-hidden">
            {/* Main Nav */}
            <nav className="flex-1 px-3 space-y-1 overflow-y-auto" aria-label="Main">
              {mainNavItems.map((item) => (
                <NavLink
                  key={item.name}
                  to={item.path}
                  end={item.path === '/responder'}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 text-sm font-medium ${
                      isActive
                        ? 'bg-[rgba(244,161,133,0.27)] text-primary'
                        : 'text-[#52525B] hover:bg-border-light/30 hover:text-text-heading'
                    }`
                  }
                >
                  <item.icon className="w-[18px] h-[18px]" />
                  <span>{item.name}</span>
                </NavLink>
              ))}
            </nav>

            {/* Secondary Nav */}
            <div className="px-3 pt-6 pb-6 border-t border-border-light mt-auto shrink-0">
              {secondaryNavItems.map((item) => (
                <NavLink
                  key={item.name}
                  to={item.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 text-sm font-medium ${
                      isActive
                        ? 'bg-[rgba(244,161,133,0.27)] text-primary'
                        : 'text-[#52525B] hover:bg-border-light/30 hover:text-text-heading'
                    }`
                  }
                >
                  <item.icon className="w-[18px] h-[18px]" />
                  <span>{item.name}</span>
                </NavLink>
              ))}
            </div>
          </div>
        </aside>

        {/* ─── Main Content ─── */}
        <main className="flex-1 h-full overflow-y-auto flex flex-col relative z-0">
          <div className="p-6 md:p-10 flex-1">
            <ResponderAlarm />
            <GlobalErrorBoundary>
              <Outlet />
            </GlobalErrorBoundary>
          </div>
        </main>
      </div>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-30 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-border animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-text-heading mb-2">Log out?</h3>
            <p className="text-sm text-text-body mb-6">Are you sure you want to end your session? You will need to re-authenticate to access the dashboard again.</p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="px-4 py-2 text-sm font-bold text-text-muted hover:text-text-heading transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSignOut}
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
