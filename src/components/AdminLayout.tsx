import React from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, AlertTriangle, Settings, Cpu, LogOut, Menu, X, BarChart3, FileText } from 'lucide-react';
import { NotificationDropdown, HeaderSearchBar, UserMenuDropdown } from './HeaderWidgets';
import { useAuth } from '../contexts/AuthContext';

export const AdminLayout: React.FC = () => {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [showLogoutModal, setShowLogoutModal] = React.useState(false);


  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const mainNavItems = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'User Management', path: '/admin/users', icon: Users },
    { name: 'Device Registration', path: '/admin/devices', icon: Cpu },
    { name: 'System Overview', path: '/admin/alerts', icon: BarChart3 },
    { name: 'System Log', path: '/admin/logs', icon: FileText },
  ];

  const secondaryNavItems = [
    { name: 'Settings', path: '/admin/settings/security', icon: Settings },
    { name: 'Logout', path: '#logout', icon: LogOut },
  ];

  return (
    <div className="h-screen w-screen bg-surface font-sans flex flex-col overflow-hidden">
      
      {/* ─── Top Navigation Bar ─── */}
      <header className="shrink-0 h-[69px] z-50 bg-[#B91C1C] flex items-center justify-between px-3 md:px-8 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        {/* Brand */}
        <div className="flex items-center gap-0 min-w-0 shrink-0">
          <span className="text-white font-bold text-xl sm:text-2xl md:text-[32px] leading-7 tracking-[-0.03em] whitespace-nowrap">
            AgapSense{' '}
          </span>
          <span className="hidden md:inline-block w-px h-4 bg-white/50 mx-4"></span>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-3 md:gap-6">
          {/* Search */}
          <HeaderSearchBar devicesPath="/admin/devices" />

          {/* Notification Bell */}
          <NotificationDropdown alertsPath="/admin/alerts" />

          {/* User Avatar */}
          <UserMenuDropdown settingsPath="/admin/settings/security" />

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-1 text-white shrink-0"
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
            {/* Sidebar Heading */}
            <div className="px-6 pb-0 shrink-0">
              <div className="flex items-center gap-2 mb-1">
                <svg width="20" height="26" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 0C12 0 4 8 4 16C4 20.4183 7.58172 24 12 24C16.4183 24 20 20.4183 20 16C20 8 12 0 12 0Z" fill="#D32F2F"/>
                  <path d="M12 12C12 12 8 16 8 20C8 22.2091 9.79086 24 12 24C14.2091 24 16 22.2091 16 20C16 16 12 12 12 12Z" fill="#FF8A65"/>
                </svg>
                <h1 className="text-text-heading font-black text-3xl tracking-[-0.03em]">
                  AgapSense
                </h1>
              </div>
              <div className="mt-2">
                <span className="text-primary font-bold text-[10px] leading-[15px] tracking-[0.1em] uppercase">
                  smarter detection, faster response
                </span>
              </div>
            </div>

            {/* Main Nav */}
            <nav className="flex-1 px-3 mt-8 space-y-1 overflow-y-auto">
              {mainNavItems.map((item) => (
                <NavLink
                  key={item.name}
                  to={item.path}
                  end={item.path === '/dashboard'}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 text-sm font-medium ${
                      isActive
                        ? 'bg-[rgba(244,161,133,0.27)] text-[#B91C1C]'
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
              {secondaryNavItems.map((item) =>
                item.path === '#logout' ? (
                  <button
                    key={item.name}
                    onClick={() => setShowLogoutModal(true)}
                    className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-[#52525B] hover:bg-border-light/30 hover:text-text-heading transition-all duration-200 w-full"
                  >
                    <item.icon className="w-[18px] h-[18px]" />
                    <span>{item.name}</span>
                  </button>
                ) : (
                  <NavLink
                    key={item.name}
                    to={item.path}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 text-sm font-medium ${
                        isActive
                          ? 'bg-[rgba(244,161,133,0.27)] text-[#B91C1C]'
                          : 'text-[#52525B] hover:bg-border-light/30 hover:text-text-heading'
                      }`
                    }
                  >
                    <item.icon className="w-[18px] h-[18px]" />
                    <span>{item.name}</span>
                  </NavLink>
                )
              )}
            </div>
          </div>
        </aside>

        {/* ─── Main Content ─── */}
        <main className="flex-1 h-full overflow-y-auto flex flex-col relative z-0">
          <div className={location.pathname === '/admin/map' ? 'flex-1 flex flex-col relative min-h-full' : 'p-6 md:p-10 flex-1'}>
            <Outlet />
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
            <h3 className="text-xl font-bold text-text-heading mb-2">Confirm Logout</h3>
            <p className="text-sm text-text-body mb-6">Are you sure you want to end your session? You will need to re-authenticate to access the dashboard again.</p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="px-4 py-2 text-sm font-bold text-text-muted hover:text-text-heading transition-colors"
              >
                CANCEL
              </button>
              <button
                onClick={handleSignOut}
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
