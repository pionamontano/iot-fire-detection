import React, { useEffect } from 'react';
import { registerServiceWorker, refreshPushSubscription } from './lib/pushNotifications';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { AuthGuard } from './components/AuthGuard';
import { AdminLayout } from './components/AdminLayout';
import { ResponderLayout } from './components/ResponderLayout';
import { ResidentLayout } from './components/ResidentLayout';

// Redirect that keeps ?query (e.g. ?q=AGS-001&device=…) on the new address.
const RedirectKeepingQuery = ({ to }: { to: string }) => {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
};

// Pages - Auth
import { Login } from './pages/auth/Login';
import { RegisterResident } from './pages/auth/RegisterResident';
import { RegisterResponder } from './pages/auth/RegisterResponder';
import { ForgotPassword } from './pages/auth/ForgotPassword';
import { ResetPassword } from './pages/auth/ResetPassword';
import { PendingApproval } from './pages/auth/PendingApproval';
import { SessionExpired } from './pages/auth/SessionExpired';

// Pages - Admin
import { Dashboard } from './pages/admin/Dashboard';
import { Devices } from './pages/admin/Devices';
import { Users } from './pages/admin/Users';
import { DeviceStatusPage } from './pages/admin/DeviceStatus';
import { Logs } from './pages/admin/Logs';
import { SupportRequests } from './pages/admin/SupportRequests';
import { InteractiveMap } from './pages/admin/InteractiveMap';
import { Settings } from './pages/admin/Settings';

// Pages - Responder
import { ResponderDashboard } from './pages/responder/ResponderDashboard';
import { ResponderAlertLogs } from './pages/responder/ResponderAlertLogs';
import { ResponderSettings } from './pages/responder/ResponderSettings';

// Pages - Resident
import { ResidentHome } from './pages/resident/ResidentHome';
import { ResidentSetup } from './pages/resident/ResidentSetup';
import { ResidentAlertSettings } from './pages/resident/ResidentAlertSettings';
import { ResidentDeviceInfo } from './pages/resident/ResidentDeviceInfo';
import { ResidentAlerts } from './pages/resident/ResidentAlerts';
import { ResidentAccount } from './pages/resident/ResidentAccount';

// Pages - Common
import { NotFound } from './pages/common/NotFound';

function App() {

  useEffect(() => {
    // A browser still subscribed with an old push key would never receive alerts; renew it quietly.
    registerServiceWorker().then((registration) => { if (registration) refreshPushSubscription(); });
  }, []);
    return (
    <AuthProvider>
      <BrowserRouter>
        <GlobalErrorBoundary>
          <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register/resident" element={<RegisterResident />} />
          <Route path="/register/responder" element={<RegisterResponder />} />
          <Route path="/pending-approval" element={<PendingApproval />} />
          <Route path="/session-expired" element={<SessionExpired />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Admin Routes */}
          <Route element={<AuthGuard allowedRoles={['admin']} />}>
            <Route element={<AdminLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/admin/map" element={<InteractiveMap />} />
              <Route path="/admin/devices" element={<Devices />} />
              <Route path="/admin/users" element={<Users />} />
              <Route path="/admin/status" element={<DeviceStatusPage />} />
              {/* Old address of Device Status (was "System Overview"); kept so bookmarks and links still work. */}
              <Route path="/admin/alerts" element={<RedirectKeepingQuery to="/admin/status" />} />
              <Route path="/admin/logs" element={<Logs />} />
              <Route path="/admin/support" element={<SupportRequests />} />
              <Route path="/admin/settings/security" element={<Settings />} />
            </Route>
          </Route>

          {/* BFP Responder Routes */}
          <Route element={<AuthGuard allowedRoles={['bfp_responder']} />}>
            <Route element={<ResponderLayout />}>
              <Route path="/responder" element={<ResponderDashboard />} />
              <Route path="/responder/alerts" element={<ResponderAlertLogs />} />
              <Route path="/responder/settings" element={<ResponderSettings />} />
            </Route>
          </Route>

          {/* Resident Routes */}
          <Route element={<AuthGuard allowedRoles={['resident']} />}>
            <Route path="/setup" element={<ResidentSetup />} />
            <Route element={<ResidentLayout />}>
              <Route path="/home" element={<ResidentHome />} />
              <Route path="/home/alerts" element={<ResidentAlerts />} />
              <Route path="/home/settings" element={<ResidentAlertSettings />} />
              <Route path="/home/devices" element={<ResidentDeviceInfo />} />
              {/* The resident System Log was merged into Alert History. */}
              <Route path="/home/logs" element={<RedirectKeepingQuery to="/home/alerts" />} />
              <Route path="/account" element={<ResidentAccount />} />
            </Route>
          </Route>

          {/* Root Redirect based on AuthGuard default behavior (if logged in, redirects to role home, else login) */}
          <Route path="/" element={<AuthGuard />} />

          {/* 404 Fallback */}
          <Route path="*" element={<NotFound />} />
          </Routes>
        </GlobalErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
