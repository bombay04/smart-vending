export interface AuthenticatedEmployee {
  id: number;
  name: string;
  employeeCode: string;
}

export interface RegistrationEmployee extends AuthenticatedEmployee {
  isActive: boolean;
  faceRegistered: boolean;
  canDeleteDraft: boolean;
  activeCleanupType: "EMPLOYEE_DRAFT_DELETE" | "EMPLOYEE_OFFBOARDING" | null;
}
