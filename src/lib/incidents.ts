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
