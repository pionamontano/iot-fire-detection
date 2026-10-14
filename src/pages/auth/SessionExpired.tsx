import { Link } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { AuthLayout, AuthAlert, AUTH_BTN_PRIMARY } from '../../components/AuthLayout';

export const SessionExpired = () => (
  <AuthLayout title="Session expired">
    <div className="space-y-6">
      <AuthAlert tone="warning">
        For your security, you were signed out after a period of inactivity. Sign in again to continue.
      </AuthAlert>
      <Link to="/login" className={AUTH_BTN_PRIMARY}>
        <LogIn className="w-4 h-4" /> Sign in again
      </Link>
    </div>
  </AuthLayout>
);
