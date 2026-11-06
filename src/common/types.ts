import type { UserType } from './constants/enums';

export interface ResidentCtx {
  id: string;
  flatId: string;
  residentType: string;
  isPrimary: boolean;
  permissions: Record<string, boolean>;
}

export interface AuthContext {
  userId: string;
  userType: UserType;
  role: UserType;
  societyId?: string;
  societyName?: string;
  permissions: Set<string>;
  features: Record<string, boolean>;
  impersonationId?: string;
  adminProfileId?: string;
  guardId?: string;
  gateId?: string;
  residents: ResidentCtx[];
  flatIds: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth: AuthContext;
      valid: { body: any; query: any; params: any };
      requestId: string;
    }
  }
}
