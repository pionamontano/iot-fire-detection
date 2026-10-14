import type { Option } from '../components/pickers';

// Role choices for the admin role pickers (Users edit, Support Requests role change).
export const ROLE_OPTIONS: Option[] = [
  { value: 'resident', title: 'Resident / Owner', detail: 'Owns a device and gets home alerts' },
  { value: 'bfp_responder', title: 'BFP Responder', detail: 'Receives and responds to fire alerts' },
  { value: 'admin', title: 'Administrator', detail: 'Full access to this dashboard' },
];
