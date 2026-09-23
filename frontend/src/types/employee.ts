export interface AuthenticatedEmployee {
  id: number;
  name: string;
  employeeCode: string;
}

export interface RegistrationEmployee extends AuthenticatedEmployee {
  isActive: boolean;
  faceRegistered: boolean;
}
