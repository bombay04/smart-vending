interface FaceRegistrationSessionCleanupDependencies {
  sessionId: number;
  cancelSession: (sessionId: number) => Promise<unknown>;
  clearLocalState: () => void;
}

export function cancelFaceRegistrationSessionAndCleanup(
  dependencies: FaceRegistrationSessionCleanupDependencies,
): Promise<void>;

export function canCancelFaceRegistration(state: string): boolean;
