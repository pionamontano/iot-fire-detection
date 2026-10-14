import { Link, useLocation } from 'react-router-dom';
import { AuthLayout, AuthAlert, AUTH_BTN_SECONDARY } from '../../components/AuthLayout';

export const PendingApproval = () => {
  const location = useLocation();
  const deviceCodeUnrecognized = (location.state as { deviceCodeUnrecognized?: boolean } | null)?.deviceCodeUnrecognized;

  return (
    <AuthLayout
      title="Registration submitted"
      subtitle="Thanks for registering. An administrator will review your details, and you'll be able to sign in once your account is approved."
    >
      <div className="space-y-6">
        <AuthAlert tone="success">
          Your account is <strong>waiting for approval</strong>. Try signing in again later.
        </AuthAlert>

        {deviceCodeUnrecognized && (
          <AuthAlert tone="warning">
            We don't recognize the device code you entered yet. That's fine if your device hasn't been set up -
            an administrator will confirm it during review.
          </AuthAlert>
        )}

        <Link to="/login" className={AUTH_BTN_SECONDARY}>Back to sign in</Link>
      </div>
    </AuthLayout>
  );
};
