import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useIdleTimeout } from '../hooks/useIdleTimeout';
import type { Role } from '../lib/supabase';
import { LogOut } from 'lucide-react';
import { AuthLayout, AuthAlert, AUTH_BTN_SECONDARY } from './AuthLayout';

interface AuthGuardProps {
  allowedRoles?: Role[];
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ allowedRoles }) => {
  const { session, profile, loading, signOut } = useAuth();
  const location = useLocation();

  // Enforced here (rather than per-page) so it covers every protected route
  // regardless of role, using this instance's Outlet. Only active once a
  // session + approved profile actually exist.
  useIdleTimeout(profile?.role, Boolean(session && profile && profile.status === 'approved' && profile.is_active !== false));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-light">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Signed in but not allowed in yet: same layout as the sign-in pages.
  const signOutButton = (
    <button type="button" onClick={() => signOut()} className={AUTH_BTN_SECONDARY}>
      <LogOut className="w-4 h-4" /> Sign out
    </button>
  );

  if (!profile) {
    return (
      <AuthLayout title="We couldn't load your account">
        <div className="space-y-6">
          <AuthAlert tone="error">
            You're signed in, but your account details couldn't be loaded. Sign out and try again.
            If it keeps happening, contact your AgapSense administrator.
          </AuthAlert>
          {signOutButton}
        </div>
      </AuthLayout>
    );
  }

  // Deactivated by an admin (manage-user). The auth ban already blocks new
  // sign-ins and token refreshes; this covers a session that was open when
  // the account was deactivated.
  if (profile.is_active === false) {
    return (
      <AuthLayout title="Account deactivated">
        <div className="space-y-6">
          <AuthAlert tone="error">
            An administrator has deactivated your account. If you think this is a mistake,
            contact your AgapSense administrator.
          </AuthAlert>
          {signOutButton}
        </div>
      </AuthLayout>
    );
  }

  if (profile.status !== 'approved') {
    const pending = profile.status === 'pending';
    return (
      <AuthLayout
        title={pending ? 'Registration under review' : 'Registration not approved'}
        subtitle={pending
          ? 'Thanks for registering. An administrator is reviewing your details.'
          : undefined}
      >
        <div className="space-y-6">
          {pending ? (
            <AuthAlert tone="warning">
              Your account is <strong>waiting for approval</strong>. You'll be able to use AgapSense
              once an administrator approves it. Try signing in again later.
            </AuthAlert>
          ) : (
            <AuthAlert tone="error">
              Your registration was not approved. Contact your AgapSense administrator for details.
            </AuthAlert>
          )}
          {signOutButton}
        </div>
      </AuthLayout>
    );
  }

  if (
    location.pathname === '/' || 
    (allowedRoles && !allowedRoles.includes(profile.role))
  ) {
    // Redirect to correct home based on role
    if (profile.role === 'admin') return <Navigate to="/dashboard" replace />;
    if (profile.role === 'bfp_responder') return <Navigate to="/responder" replace />;
    if (profile.role === 'resident') {
      return profile.setup_complete ? <Navigate to="/home" replace /> : <Navigate to="/setup" replace />;
    }
  }

  // Enforce resident setup — cannot be skipped by navigating directly to another route
  if (profile.role === 'resident' && !profile.setup_complete && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }
  
  if (profile.role === 'resident' && profile.setup_complete && location.pathname === '/setup') {
    return <Navigate to="/home" replace />;
  }

  return <Outlet />;
};
