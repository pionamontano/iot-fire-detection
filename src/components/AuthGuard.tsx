import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useIdleTimeout } from '../hooks/useIdleTimeout';
import type { Role } from '../lib/supabase';

interface AuthGuardProps {
  allowedRoles?: Role[];
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ allowedRoles }) => {
  const { session, profile, loading, signOut } = useAuth();
  const location = useLocation();

  // Enforced here (rather than per-page) so it covers every protected route
  // regardless of role, using this instance's Outlet. Only active once a
  // session + approved profile actually exist.
  useIdleTimeout(profile?.role, Boolean(session && profile && profile.status === 'approved'));

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

  if (!profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg-light p-4">
        <div className="bg-white p-6 rounded-lg shadow-md max-w-md w-full text-center">
          <div className="text-red-500 mb-4">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Profile Missing or Error</h2>
          <p className="text-gray-600 mb-6">
            We authenticated your account, but couldn't load your profile. 
            Did you insert your user into the <code>profiles</code> table in the Supabase Dashboard?
          </p>
          <button 
            onClick={() => signOut()} 
            className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-hover transition-colors"
          >
            Sign Out & Try Again
          </button>
        </div>
      </div>
    );
  }

  if (profile.status !== 'approved') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FCF9F8] p-4 font-['Inter',_sans-serif]">
        <div className="bg-white p-8 rounded-xl shadow-[0_24px_48px_rgba(0,0,0,0.08)] border border-[#E5E2E1] max-w-md w-full text-center">
          <div className="w-16 h-16 bg-[#FEF3C7] rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[#D97706]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-black text-[#231918] mb-2">Account {profile.status === 'pending' ? 'Pending' : 'Rejected'}</h2>
          <p className="text-[#534341] text-sm mb-6 leading-relaxed">
            {profile.status === 'pending' 
              ? "Your registration is currently under review by an administrator. You will be able to access the system once approved."
              : "Your registration request has been rejected. Please contact your system administrator for more details."}
          </p>
          <button 
            onClick={() => signOut()} 
            className="w-full py-3 bg-[#D32F2F] text-white font-bold text-sm tracking-[0.1em] uppercase rounded-lg shadow-sm hover:bg-[#B91C1C] transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
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
