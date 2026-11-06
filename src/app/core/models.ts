export type Role = 'SALES' | 'REVIEWER' | 'ADMIN';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export type ApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
export const APPLICATION_STATUSES: readonly ApplicationStatus[] = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'];

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ApplicationSummary {
  id: string;
  legalName: string;
  status: ApplicationStatus;
  createdByName: string;
  assignedReviewerName: string | null;
  updatedAt: string;
}


export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListQuery {
  page: number;
  pageSize: number;
  status: ApplicationStatus | '';
  q: string;
}

export interface BusinessData {
  legalName: string;
  dba: string;
  taxId: string;
  industry: string;
  website: string;
  phone: string;
  email: string;
  line1: string;
  city: string;
  postalCode: string;
}

export interface OwnerData {
  fullName: string;
  title: string;
  ownershipPercent: number;
  nationalId: string;
  email: string;
}

export interface BankingData {
  bankName: string;
  routingNumber: string;
  accountNumber: string;
}

/** The payload the wizard edits and autosaves (what the API calls a "draft"). */
export interface ApplicationData {
  business: BusinessData;
  owners: OwnerData[];
  banking: BankingData;
}

export type RiskEventType = 'SUBMISSION' | 'ASSIGNMENT' | 'DECISION';

export interface RiskEvent {
  id: string;
  at: string;
  byName: string;
  type: RiskEventType;
  riskLevel?: RiskLevel;
  note?: string;
}

/**
 * Server-computed capabilities. The UI uses these to decide what to *show*;
 * the server independently enforces them on every request.
 */
export interface Permissions {
  canEdit: boolean;
  canReveal: boolean;
  canDecide: boolean;
  canAssign: boolean;
}


export interface ApplicationDetail {
  id: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  createdByName: string;
  assignedReviewer: { id: string; name: string } | null;
  data: ApplicationData;
  /** true when sensitive fields in `data` are masked placeholders, not real values. */
  sensitiveMasked: boolean;
  riskHistory: RiskEvent[];
  permissions: Permissions;
}

export type SensitiveFieldName = 'taxId' | 'accountNumber' | 'ownerNationalId';

export interface DecisionPayload {
  decision: 'APPROVED' | 'REJECTED';
  riskLevel: RiskLevel;
  note: string;
}

