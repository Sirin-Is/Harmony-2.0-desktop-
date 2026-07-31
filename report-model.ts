// report-model.ts
// Business logic for "Звітність". Поведінка ідентична report-model.js.

import { DEFAULT_WORKING_YEAR, daysUntil } from './utils.ts';
import { taxPeriodsFor, controlDeadline, quarterEnd, type Period, type TabGroup } from './tax-model.ts';
import type { Database, ReportRecord } from './types';

export const REPORT_GROUPS: TabGroup[] = [
  { key: '12', label: '1-2 група' },
  { key: '3', label: '3 група' },
];

export function reportPeriodsFor(group: string, workingYear: number): Period[] {
  return group === '3' ? taxPeriodsFor('3', workingYear) : [{ key: String(workingYear), label: `Рік ${workingYear}` }];
}

function reportRecordKey(clientId: string, realGroup: string, period: string): string {
  return `${clientId}|${realGroup}|${period}`;
}

export function getReportRecord(db: Database, clientId: string, realGroup: string, period: string): ReportRecord {
  const key = reportRecordKey(clientId, realGroup, period);
  if (!db.reportRecords[key] && period.startsWith(`${DEFAULT_WORKING_YEAR}-`)) {
    const legacy = db.reportRecords[reportRecordKey(clientId, realGroup, period.slice(5))];
    if (legacy) db.reportRecords[key] = { ...legacy };
  }
  return db.reportRecords[key] ||= {};
}

export function getDefaultReportDeadline(db: Database, realGroup: string, periodKey: string): string {
  const end = realGroup === '3' ? quarterEnd(periodKey) : new Date(Number(periodKey), 11, 31);
  end.setDate(end.getDate() + (realGroup === '3' ? 40 : 60));
  const date = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  return controlDeadline(date);
}

export function effectiveReportDeadline(db: Database, realGroup: string, periodKey: string, record: ReportRecord): string {
  return record.deadline || getDefaultReportDeadline(db, realGroup, periodKey);
}

export interface ReportStatus { text: string; cls: 'ok' | 'warn' | 'late' | 'neutral' }

export function reportStatus(record: ReportRecord, deadline?: string): ReportStatus {
  if (record.submittedDate) return { text: 'Подано', cls: 'ok' };
  const days = daysUntil(deadline);
  if (days !== null && days < 0) return { text: 'Пропущено', cls: 'late' };
  if (days !== null && days <= 5) return { text: 'Скоро дедлайн', cls: 'warn' };
  return { text: 'Очікуємо', cls: 'neutral' };
}

export function reportStatusPillHtml(record: ReportRecord, deadline?: string): string {
  const status = reportStatus(record, deadline);
  return `<span class="pill ${status.cls}">${status.text}</span>`;
}

/** Same freeze-on-submission semantics as tax-model's daysUntilLabel, reused via the "submittedDate" alias. */
export function reportDaysUntilLabel(deadline: string | undefined, record: ReportRecord): string {
  if (!deadline) return '-';
  const days = daysUntil(deadline);
  if (days === null) return '-';
  if (days < 0) return `<span class="pill late">${days} дн.</span>`;
  if (!record.submittedDate && days <= 5) return `<span class="pill warn">${days} дн.</span>`;
  return `<span class="pill ok">${days} дн.</span>`;
}
