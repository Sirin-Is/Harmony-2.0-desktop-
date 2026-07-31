// types.ts
// Єдине джерело правди для форми даних застосунку. Використовується зараз
// лише UI-шаром (через *.ts моделі); в Етапі 5 ці ж інтерфейси стануть
// основою для SQL-схеми й Repository-шару, в Етапі 6 — для типів,
// якими SyncManager обмінюється з Supabase. Саме тому вони винесені в
// окремий файл без жодної залежності від DOM/UI/storage.

export interface BankAccount {
  id?: string;
  bankName?: string;
  code?: string;
  bankCode?: string;
  currency?: string;
  iban?: string;
  openDate?: string;
  registeredDate?: string;
}

export interface Employee {
  id: string;
  name: string;
  position?: string;
}

export interface HrOrder {
  id: string;
  clientId?: string;
  number: string;
  date: string;
  subject: string;
  employeeName?: string;
  effectiveDate: string;
  deliveryStatus?: 'Надіслано' | 'Не надіслано';
  period?: string;
}

/**
 * Клієнт (ФОП). Поле `[key: string]: unknown` лишається навмисно — до
 * повної нормалізації в Repository-шарі (Етап 5) картка клієнта ще може
 * містити довільні додаткові поля, і звужувати тип раніше часу означало б
 * або зламати компіляцію на рівному місці, або приховати реальні дані.
 */
export interface Client {
  id: string;
  form?: string;
  name: string;
  group?: string; // '1' | '2' | '3' | 'Загальна'
  rate?: string;
  serviceCost?: string | number;
  currency?: string;
  phone?: string;
  email?: string;
  contactLink?: string;
  bankAccess?: string;
  prro?: string;
  employeesCount?: string | number;
  employees?: Employee[];
  hadEmployees?: boolean;
  kepIssuer?: string;
  kepExpiry?: string;
  taxOffice?: string;
  banks?: string;
  activities?: string;
  archived?: boolean;
  lifecycleStatus?: 'active' | 'inactive' | 'deleted';
  inactiveReason?: string;
  inactiveAt?: string;
  deletedAt?: string;
  deletionRequestedAt?: string;
  deletionEligibleAt?: string;
  isTestRecord?: boolean;
  customFields?: Record<string, string>;
  rnokpp?: string;
  source?: string;
  contractFileName?: string;
  contractLink?: string;
  contractNumber?: string;
  agreementsText?: string;
  pricingBase?: string | number;
  pricingStaff?: string | number;
  pricingPrro?: string | number;
  staffStatus?: string;
  prroName?: string;
  kepValidFrom?: string;
  registrationAddress?: string;
  kvedMainCode?: string;
  kvedMainName?: string;
  kvedAdditional?: string | Array<{ id?: string; code?: string; name?: string }>;
  additionalInfo?: string;
  accounts?: BankAccount[];
  [key: string]: unknown;
}

export interface CustomColumn {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date';
}

export interface TaxRecord {
  queuedDate?: string;
  paidDate?: string;
  deadline?: string;
  exemption?: string;
  note?: string;
}

export interface ReportRecord {
  submittedDate?: string;
  deadline?: string;
  note?: string;
}

export interface MonthlyPaymentCell {
  charged?: string;
  paid?: string;
}

export interface CalendarEvent {
  id: string;
  clientId?: string;
  eventDate: string;
  eventTime?: string;
  title?: string;
  note: string;
  kind: 'note';
  completedAt?: string;
  completedDates?: string[];
  workdayShift?: 'previous' | 'next';
  subtasks?: Array<{
    id: string;
    title: string;
    completedAt?: string;
    completedDates?: string[];
  }>;
  recurrence?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'months';
    interval?: number;
    until?: string;
    moveToPreviousWorkday?: boolean;
  };
}

export interface HrMonthlyDocuments {
  id: string;
  clientId: string;
  period: string;
  timesheetStatus: 'Надіслано' | 'Не надіслано';
  payrollStatus: 'Надіслано' | 'Не надіслано';
  cashStatementStatus: 'Надіслано' | 'Не надіслано';
}

export interface PayrollRecord {
  id: string;
  clientId: string;
  employeeId: string;
  employeeName: string;
  period: string;
  paymentDate?: string;
  amount?: string;
  pdfo?: string;
  vz?: string;
  esv?: string;
  status: 'Набрано' | 'Сплачено' | 'Повідомлено' | 'Сплачено невчасно';
  paymentType?: string;
}

export interface AuditOperation {
  id: string;
  occurredAt: string;
  action: string;
  actor: string;
  status: 'active' | 'cancelled' | 'rollback';
  beforeSnapshot?: Omit<Database, 'auditOperations' | 'auditEvents'>;
  cancelledAt?: string;
  cancelledBy?: string;
}

export interface AuditEvent {
  id: string;
  operationId: string;
  occurredAt: string;
  actor: string;
  type: string;
  description: string;
  section?: string;
  clientId?: string;
  clientName?: string;
  field?: string;
  status: 'active' | 'cancelled';
  oldValue?: string;
  newValue?: string;
}

/** clientId -> monthKey ("2026-01") -> {charged, paid} */
export type MonthlyPayments = Record<string, Record<string, MonthlyPaymentCell>>;
/** clientId -> monthKey -> сума доходу (рядок, як у полі вводу) */
export type IncomeRecords = Record<string, Record<string, string>>;
/** ключ "clientId|realGroup|period|taxType" -> запис */
export type TaxRecords = Record<string, TaxRecord>;
/** ключ "clientId|realGroup|period" -> запис */
export type ReportRecords = Record<string, ReportRecord>;

export interface Settings {
  workingYear: number;
  availableWorkingYears: number[];
  minWage: number;
  monthlyDeadlines: Record<string, string>;
  quarterlyDeadlines: { group3: Record<string, string>; esv: Record<string, string> };
  reportDeadlines: { annual: Record<string, string>; quarterly: Record<string, string> };
  appearance?: { fieldColor: string; fieldRadius: number; fieldOpacity: number };
}

/** Точна форма того, що зараз зберігається одним JSONB-рядком у Supabase (та ж форма, що й у storage.js). */
export interface Database {
  clients: Client[];
  customColumns: CustomColumn[];
  monthlyPayments: MonthlyPayments;
  taxRecords: TaxRecords;
  incomeRecords: IncomeRecords;
  reportRecords: ReportRecords;
  calendarEvents: CalendarEvent[];
  hrOrders: HrOrder[];
  hrMonthlyDocuments: HrMonthlyDocuments[];
  payrollRecords: PayrollRecord[];
  auditOperations: AuditOperation[];
  auditEvents: AuditEvent[];
  settings: Settings;
}
