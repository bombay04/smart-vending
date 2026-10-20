export interface StaffSessionPollState<TSession> {
  session: TSession | null;
  sessionLoaded: boolean;
  statusAvailable: boolean;
  consecutiveFailures: number;
  pollingError: string | null;
}

export type StaffSessionPollEvent<TSession> =
  | { type: "POLL_SUCCEEDED"; session: TSession | null }
  | { type: "POLL_FAILED" }
  | { type: "SESSION_STARTED"; session: TSession }
  | { type: "SESSION_CANCELLED" };

export const STAFF_SESSION_POLL_FAILURE_THRESHOLD: 3;

export function createStaffSessionPollState<
  TSession,
>(): StaffSessionPollState<TSession>;

export function reduceStaffSessionPollState<TSession>(
  state: StaffSessionPollState<TSession>,
  event: StaffSessionPollEvent<TSession>,
): StaffSessionPollState<TSession>;
