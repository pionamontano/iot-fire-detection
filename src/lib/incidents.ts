// Client side of the incident lifecycle (Step 6.2).
//
// The DATABASE is authoritative: every status change goes through the `transition_incident` RPC
// (migration 20261021000000), which validates the transition, checks the caller (approved + active admin or
// responder) and sets the actor and timestamps on the server. This file only
//   * decides which action buttons to OFFER (mirrors the database's transition table; the server still enforces it),
//   * calls the RPC, and
//   * turns database errors into messages a responder can act on.
// Never write alert_events.incident_status / acknowledged_* / resolved_* directly from the UI.

export type IncidentStatus = 'active' | 'acknowledged' | 'responding' | 'resolved' | 'false_alarm';
export type IncidentTarget = Exclude<IncidentStatus, 'active'>;
export type ActorRole = 'admin' | 'bfp_responder';

const CLOSED: ReadonlyArray<IncidentStatus> = ['resolved', 'false_alarm'];

export const isClosedStatus = (s: IncidentStatus | null | undefined): boolean => !!s && CLOSED.includes(s);

/**
 * Targets the given role may request from `from` (UI hint only). Mirrors the transition table in
 * transition_incident():  active -> acknowledged; acknowledged -> responding | resolved | false_alarm;
 * responding -> resolved | false_alarm; admin may also close any open incident. A closed incident offers nothing.
 * A missing status (legacy rows typed as optional) is treated as 'active', which is the column default.
 */
export const availableTransitions = (from: IncidentStatus | null | undefined, role: ActorRole): IncidentTarget[] => {
  const status: IncidentStatus = from ?? 'active';
  switch (status) {
    case 'active':
      return role === 'admin' ? ['acknowledged', 'resolved', 'false_alarm'] : ['acknowledged'];
    case 'acknowledged':
      return ['responding', 'resolved', 'false_alarm'];
    case 'responding':
      return ['resolved', 'false_alarm'];
    default:
      return [];
  }
};

export const closeConfirmMessage = (to: 'resolved' | 'false_alarm'): string =>
  to === 'resolved'
    ? 'Mark this incident as RESOLVED? A closed incident cannot be reopened.'
    : 'Mark this incident as a FALSE ALARM? A closed incident cannot be reopened.';

export interface IncidentActionError {
  message: string;
  /** true when the list is probably stale (someone else changed the incident), so the caller should refetch. */
  refresh: boolean;
}

interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
}

/** Maps the SQLSTATEs raised by transition_incident() (and PostgREST) to plain-language messages. */
export const describeIncidentError = (error: RpcErrorLike | null | undefined): IncidentActionError => {
  switch (error?.code) {
    case '42501':
      return { message: 'You are not allowed to update incidents. Your account must be approved and active.', refresh: false };
    case '55000':
      return { message: 'This incident was already updated by someone else, or is closed. The list has been refreshed.', refresh: true };
    case 'P0002':
      return { message: 'This incident no longer exists. The list has been refreshed.', refresh: true };
    case '22023':
    case '22001':
      return { message: 'The request was not valid and was not applied.', refresh: false };
    case 'PGRST202':
      return { message: 'Incident actions are unavailable until the database update (transition_incident) has been applied.', refresh: false };
    default:
      return { message: error?.message ? `Could not update the incident: ${error.message}` : 'Could not update the incident. Please try again.', refresh: false };
  }
};

export type TransitionResult =
  | { ok: true; incident: unknown }
  | ({ ok: false } & IncidentActionError);

/** The slice of the Supabase client this module needs (keeps it testable without a network). */
export interface RpcClient {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcErrorLike | null }>;
}

/** Calls transition_incident. Never throws: a network failure becomes an error result. */
export const transitionIncident = async (
  client: RpcClient,
  alertId: string,
  to: IncidentTarget,
  notes?: string,
): Promise<TransitionResult> => {
  try {
    const { data, error } = await client.rpc('transition_incident', {
      p_alert_id: alertId,
      p_to: to,
      p_notes: notes ?? null,
    });
    if (error) return { ok: false, ...describeIncidentError(error) };
    return { ok: true, incident: data };
  } catch {
    return { ok: false, message: 'Network problem: the update may not have been applied. Please check and retry.', refresh: true };
  }
};

// ---- Resident: close their own Tier 1 warning (migration 20261109000000) ----
// A warning never reaches responders, so the resident is the one who can say it has been handled. Fire alerts (Tier 2) stay with responders and admins.

export const RESIDENT_RESOLVE_CONFIRM =
  'Mark this warning as resolved? Do this only after checking the room. A resolved warning cannot be reopened; ' +
  'if the readings rise again you will get a new alert.';

/** Maps the SQLSTATEs raised by resident_resolve_warning() to messages a resident can act on. */
export const describeResidentResolveError = (error: RpcErrorLike | null | undefined): IncidentActionError => {
  switch (error?.code) {
    case '42501':
      return { message: 'Your account cannot resolve alerts. It must be approved, active and linked to this device.', refresh: false };
    case '55000':
      return { message: 'This alert was already closed or has become a fire alert, so it can no longer be resolved here.', refresh: true };
    case 'P0002':
      return { message: 'This alert no longer exists.', refresh: true };
    case 'PGRST202':
      return { message: 'Resolving warnings is unavailable until the database update (resident_resolve_warning) has been applied.', refresh: false };
    default:
      return { message: error?.message ? `Could not resolve the warning: ${error.message}` : 'Could not resolve the warning. Please try again.', refresh: false };
  }
};

/** Calls resident_resolve_warning. Never throws: a network failure becomes an error result. */
export const residentResolveWarning = async (client: RpcClient, alertId: string): Promise<TransitionResult> => {
  try {
    const { data, error } = await client.rpc('resident_resolve_warning', { p_alert_id: alertId });
    if (error) return { ok: false, ...describeResidentResolveError(error) };
    return { ok: true, incident: data };
  } catch {
    return { ok: false, message: 'Network problem: the warning may not have been resolved. Please check and retry.', refresh: true };
  }
};
