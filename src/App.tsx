import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { AuthGuard } from './components/AuthGuard';
import { AdminLayout } from './components/AdminLayout';
import { ResponderLayout } from './components/ResponderLayout';
import { ResidentLayout } from './components/ResidentLayout';

// Pages
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { Users } from './pages/Users';
import { Alerts } from './pages/Alerts';
import { Logs } from './pages/Logs';
import { Settings } from './pages/Settings';
import { InteractiveMap } from './pages/InteractiveMap';
import { ResponderDashboard } from './pages/ResponderDashboard';
import { ResponderAlertLogs } from './pages/ResponderAlertLogs';
import { ResponderTeam } from './pages/ResponderTeam';
import { ResponderDevices } from './pages/ResponderDevices';
import { ResponderSettings } from './pages/ResponderSettings';
import { ResidentHome } from './pages/ResidentHome';
import { ResidentSetup } from './pages/ResidentSetup';
import { ResidentAlertSettings } from './pages/ResidentAlertSettings';
import { ResidentDeviceInfo } from './pages/ResidentDeviceInfo';
import { ResidentSystemLog } from './pages/ResidentSystemLog';
import { ResidentAccount } from './pages/ResidentAccount';
import { NotFound } from './pages/NotFound';
import { SessionExpired } from './pages/SessionExpired';
import { RegisterResident } from './pages/RegisterResident';
import { RegisterResponder } from './pages/RegisterResponder';
import { PendingApproval } from './pages/PendingApproval';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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
              <Route path="/admin/alerts" element={<Alerts />} />
              <Route path="/admin/logs" element={<Logs />} />
              <Route path="/admin/settings/security" element={<Settings />} />
            </Route>
          </Route>

          {/* BFP Responder Routes */}
          <Route element={<AuthGuard allowedRoles={['bfp_responder']} />}>
            <Route element={<ResponderLayout />}>
              <Route path="/responder" element={<ResponderDashboard />} />
              <Route path="/responder/alerts" element={<ResponderAlertLogs />} />
              <Route path="/responder/team" element={<ResponderTeam />} />
              <Route path="/responder/devices" element={<ResponderDevices />} />
              <Route path="/responder/settings" element={<ResponderSettings />} />
            </Route>
          </Route>

          {/* Resident Routes */}
          <Route element={<AuthGuard allowedRoles={['resident']} />}>
            <Route path="/setup" element={<ResidentSetup />} />
            <Route element={<ResidentLayout />}>
              <Route path="/home" element={<ResidentHome />} />
              <Route path="/home/settings" element={<ResidentAlertSettings />} />
              <Route path="/home/devices" element={<ResidentDeviceInfo />} />
              <Route path="/home/logs" element={<ResidentSystemLog />} />
              <Route path="/account" element={<ResidentAccount />} />
            </Route>
          </Route>

          {/* Root Redirect based on AuthGuard default behavior (if logged in, redirects to role home, else login) */}
          <Route path="/" element={<AuthGuard />} />

          {/* 404 Fallback */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
