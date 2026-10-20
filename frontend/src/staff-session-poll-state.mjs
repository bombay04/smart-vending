export const STAFF_SESSION_POLL_FAILURE_THRESHOLD = 3;

export function createStaffSessionPollState() {
  return {
    session: null,
    sessionLoaded: false,
    statusAvailable: false,
    consecutiveFailures: 0,
    pollingError: null,
  };
}

export function reduceStaffSessionPollState(state, event) {
  if (event.type === "POLL_SUCCEEDED" || event.type === "SESSION_STARTED") {
    return {
      session: event.session,
      sessionLoaded: true,
      statusAvailable: true,
      consecutiveFailures: 0,
      pollingError: null,
    };
  }

  if (event.type === "SESSION_CANCELLED") {
    return {
      session: null,
      sessionLoaded: true,
      statusAvailable: true,
      consecutiveFailures: 0,
      pollingError: null,
    };
  }

  if (event.type === "POLL_FAILED") {
    const consecutiveFailures = state.consecutiveFailures + 1;
    return {
      ...state,
      statusAvailable: false,
      consecutiveFailures,
      pollingError:
        consecutiveFailures >= STAFF_SESSION_POLL_FAILURE_THRESHOLD
          ? "ไม่สามารถตรวจสอบสถานะเครื่องได้ กรุณาตรวจสอบการเชื่อมต่อ"
          : null,
    };
  }

  return state;
}
