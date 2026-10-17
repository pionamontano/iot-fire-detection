import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { alertPagePath } from '../lib/alertLink';

// Target of a tapped alert notification (/alert/<alertId>?device=<deviceId>). One link goes to every
// recipient, so it is resolved here to the page where the signed-in role handles that alert.
export const AlertLink = () => {
  const { alertId } = useParams();
  const device = new URLSearchParams(useLocation().search).get('device');
  const { profile } = useAuth();
  return <Navigate to={alertPagePath(profile?.role, alertId, device)} replace />;
};
