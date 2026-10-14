// Display helpers shared by the admin Support Requests page and the requester's own list.

export const formatDateTime = (dateStr: string | null) => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
};

export const getRoleLabel = (role: string | null) => {
  switch (role) {
    case 'admin': return 'Administrator';
    case 'bfp_responder': return 'BFP Responder';
    case 'resident': return 'Resident / Owner';
    default: return role || 'Unknown role';
  }
};

// Categories offered in "Contact System Administrator", per requester role.
// Residents get no Role Change / Station Assignment: those are responder
// concerns, and a resident's "Station Assignment" used to open the admin's
// assign-device action anyway. Older requests keep their stored category.
export const DEVICE_REQUEST_CATEGORY = 'Device Link or Change';

const RESIDENT_CATEGORIES = [DEVICE_REQUEST_CATEGORY, 'Password Reset', 'Account Access / Permissions', 'Other'] as const;
const RESPONDER_CATEGORIES = ['Role Change', 'Password Reset', 'Station Assignment', 'Account Access / Permissions', 'Other'] as const;

export const supportCategoriesFor = (role: string | null | undefined): readonly string[] =>
  role === 'resident' ? RESIDENT_CATEGORIES : RESPONDER_CATEGORIES;
