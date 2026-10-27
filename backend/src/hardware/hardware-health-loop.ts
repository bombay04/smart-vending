import {
  deliverPendingHardwareAlerts,
  evaluateOfflineMachines,
} from "./hardware-monitoring.service";

export const HARDWARE_HEALTH_LOOP_INTERVAL_MS = 30_000;

export interface HardwareHealthCycleResult {
  transitions: number;
  delivery: {
    sent: number;
    failed: number;
    manualReview: number;
  };
}

export interface HardwareHealthCycleDependencies {
  evaluateOfflineMachines: () => Promise<number>;
  deliverPendingHardwareAlerts: () => Promise<HardwareHealthCycleResult["delivery"]>;
}

const defaultCycleDependencies: HardwareHealthCycleDependencies = {
  evaluateOfflineMachines,
  deliverPendingHardwareAlerts,
};

export async function runHardwareHealthCycle(
  dependencies: HardwareHealthCycleDependencies = defaultCycleDependencies,
): Promise<HardwareHealthCycleResult> {
  const transitions = await dependencies.evaluateOfflineMachines();
  const delivery = await dependencies.deliverPendingHardwareAlerts();
  return { transitions, delivery };
}

export interface HardwareHealthLoop {
  stop(): Promise<void>;
}

export interface HardwareHealthLoopOptions {
  intervalMs?: number;
  runCycle?: () => Promise<unknown>;
  onError?: (error: unknown) => void;
}

export function startHardwareHealthLoop(
  options: HardwareHealthLoopOptions = {},
): HardwareHealthLoop {
  const intervalMs = options.intervalMs ?? HARDWARE_HEALTH_LOOP_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Hardware health loop interval must be a positive number.");
  }

  const runCycle = options.runCycle ?? (() => runHardwareHealthCycle());
  const onError =
    options.onError ??
    (() => {
      console.error("Hardware health loop cycle failed.");
    });

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<unknown> | null = null;

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      inFlight = Promise.resolve()
        .then(runCycle)
        .catch(onError)
        .finally(() => {
          inFlight = null;
          schedule(intervalMs);
        });
    }, delayMs);
    timer.unref();
  };

  schedule(0);

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlight !== null) await inFlight;
    },
  };
}
