export type Role = 
  | 'AP_COORDINATOR' 
  | 'AP_SUPERVISOR' 
  | 'ACCOUNTING' 
  | 'FINANCE_MANAGER' 
  | 'DIRECTOR' 
  | 'VP' 
  | 'COO' 
  | 'AREA_COACH' 
  | 'OPS_SERVICES_MANAGER' 
  | 'IT_COORDINATOR' 
  | 'DEVELOPMENT_MANAGER';

export type Status = 'PENDING' | 'APPROVED' | 'DENIED' | 'HOLD' | 'PAID';

export interface User {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  initials: string;
  role: Role;
  division: 'C-Store' | 'Fast Food' | 'Car Wash' | 'both';
  region?: string;
  email: string;
}

export interface Store {
  id: string;
  name: string;
  division: 'C-Store' | 'Fast Food' | 'Car Wash';
  region: 'East Texas' | 'West Texas';
  acId: string | null;
  directorId: string;
}

export interface ApprovalStep {
  role: Role;
  label: string;
  userId: string;
  name: string;
  note?: string;
}

export interface ApprovalCycleStep {
  stage: Role;
  userId: string;
  action: 'APPROVED' | 'DENIED' | 'HOLD' | 'PUSH_BACK' | 'PENDING';
  ts: number;
  comment: string;
}

export interface ApprovalCycle {
  cycle: number;
  steps: ApprovalCycleStep[];
}

export interface Comment {
  id: string;
  userId: string;
  text: string;
  mentions: string[];
  ts: number;
}

export interface Invoice {
  id: string;
  vendor: string;
  amount: number;
  invoiceNumber: string;
  poNumber: string;
  date: string;
  storeId: string;
  storeName: string;
  division: 'C-Store' | 'Fast Food' | 'Car Wash';
  region: 'East Texas' | 'West Texas';
  acId: string | null;
  directorId: string;
  status: Status;
  currentStage: Role | 'PAID' | 'APPROVED';
  requiredApprovals: ApprovalStep[];
  approvalCycles: ApprovalCycle[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  paidAt: number | null;
  archived: boolean;
  comments: Comment[];
}
