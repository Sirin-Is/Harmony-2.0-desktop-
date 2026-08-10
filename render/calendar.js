import { escapeHtml, MONTH_NAMES_UA } from '../utils';
import { db, getCalendarEvents, getSettings } from '../state.js';
import { uiState } from '../ui-state.js';
import { calculatedTaxDeadline, statutoryTaxDeadline, taxPeriodsFor } from '../tax-model.ts';
import { annualPropertyIncomeDeclarationDeadline, reportPeriodsFor, getDefaultReportDeadline, statutoryReportDeadline } from '../report-model.ts';
import { payrollDatesForPeriod } from '../payroll-model.js';

const pad = (value) => String(value).padStart(2, '0');

function clientName(id) { return db.clients.find((item) => item.id === id)?.name || ''; }
function clientLabel(id) {
  const parts = clientName(id).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return `${parts[0]}${parts[1] ? ` ${parts[1][0]}.` : ''}${parts[2] ? ` ${parts[2][0]}.` : ''}`;
}
function noteTitle(event) { return event.title?.trim() || String(event.note || '').trim().split(/\r?\n/)[0] || 'Без назви'; }
function eventLabel(event) {
  if (event.source) return event.note;
  const client = clientLabel(event.clientId);
  return `${client ? `${client} ` : ''}${noteTitle(event)}`;
}
function isTaskComplete(event) { return event.recurring ? (event.completedDates || []).includes(event.occurrenceDate) : Boolean(event.completedAt); }
function isSubtaskComplete(event, subtask) { return event.recurring ? (subtask.completedDates || []).includes(event.occurrenceDate) : Boolean(subtask.completedAt); }
function isoDate(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function dateFromIso(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? new Date(`${value}T00:00:00`) : null; }
function previousWorkdayDate(date) { const adjusted = new Date(date); if (adjusted.getDay() === 6) adjusted.setDate(adjusted.getDate() - 1); if (adjusted.getDay() === 0) adjusted.setDate(adjusted.getDate() - 2); return adjusted; }
function nextWorkdayDate(date) { const adjusted = new Date(date); if (adjusted.getDay() === 6) adjusted.setDate(adjusted.getDate() + 2); if (adjusted.getDay() === 0) adjusted.setDate(adjusted.getDate() + 1); return adjusted; }
function adjustedTaskDate(event, date) {
  const shift = event.workdayShift || (event.recurrence?.moveToPreviousWorkday ? 'previous' : '');
  return shift === 'previous' ? previousWorkdayDate(date) : shift === 'next' ? nextWorkdayDate(date) : date;
}

function addMonths(date, months) {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
  return result;
}

function nextOccurrence(date, recurrence) {
  const interval = Math.max(1, Number(recurrence.interval) || 1);
  if (recurrence.frequency === 'daily') { const result = new Date(date); result.setDate(result.getDate() + interval); return result; }
  if (recurrence.frequency === 'weekly') { const result = new Date(date); result.setDate(result.getDate() + interval * 7); return result; }
  if (recurrence.frequency === 'monthly') return addMonths(date, interval);
  if (recurrence.frequency === 'quarterly') return addMonths(date, interval * 3);
  if (recurrence.frequency === 'yearly') return addMonths(date, interval * 12);
  return addMonths(date, interval);
}

function recurringEventsForMonth(events, year, month) {
  const prefix = `${year}-${pad(month)}-`;
  const lastRelevantDate = new Date(year, month, 2); // 1-ше число наступного місяця може переноситися назад на п'ятницю.
  return events.flatMap((event) => {
    if (!event.recurrence?.frequency) {
      const scheduled = dateFromIso(event.eventDate);
      if (!scheduled) return [];
      const displayDate = isoDate(adjustedTaskDate(event, scheduled));
      return displayDate.startsWith(prefix) ? [{ ...event, occurrenceDate: event.eventDate, eventDate: displayDate }] : [];
    }
    const recurrence = event.recurrence;
    let occurrence = dateFromIso(event.eventDate);
    if (!occurrence) return [];
    const result = [];
    for (let guard = 0; occurrence <= lastRelevantDate && guard < 50000; guard += 1) {
      const scheduledDate = isoDate(occurrence);
      if (recurrence.until && scheduledDate > recurrence.until) break;
      const displayDate = isoDate(adjustedTaskDate(event, occurrence));
      if (displayDate.startsWith(prefix)) result.push({ ...event, id: `${event.id}:${scheduledDate}`, seriesId: event.id, occurrenceDate: scheduledDate, eventDate: displayDate, recurring: true });
      occurrence = nextOccurrence(occurrence, recurrence);
    }
    return result;
  });
}

export function calendarTasksForDate(date) {
  const parsed = dateFromIso(date);
  if (!parsed) return [];
  return recurringEventsForMonth(getCalendarEvents(), parsed.getFullYear(), parsed.getMonth() + 1)
    .filter((event) => event.eventDate === date)
    .sort((a, b) => String(a.eventTime || '').localeCompare(String(b.eventTime || '')) || noteTitle(a).localeCompare(noteTitle(b), 'uk'));
}

function derivedEvents(year, month) {
  const prefix = `${year}-${pad(month)}-`;
  const events = [];
  const addDeadline = (item, statutory, control) => {
    if (statutory === control) { if (control?.startsWith(prefix)) events.push({ ...item, eventDate: control }); return; }
    const transferId = `deadline-transfer:${item.id}`;
    if (control?.startsWith(prefix)) events.push({ ...item, id: `${item.id}:control`, eventDate: control, note: `Внутрішній дедлайн: ${item.note}`, transferId, transferRole: 'control' });
    if (statutory?.startsWith(prefix)) events.push({ ...item, id: `${item.id}:statutory`, eventDate: statutory, note: `Законодавчий дедлайн: ${item.note}`, transferId, transferRole: 'statutory' });
  };
  taxPeriodsFor('1', year).forEach(({ key: period }) => { const deadline = calculatedTaxDeadline('1', 'unified', period);
    addDeadline({ id: `tax-default:${period}`, note: 'Останній день для сплати ЄП та ВЗ по 2 групі', source: 'tax', target: `tax|12|${period}` }, statutoryTaxDeadline('1', 'unified', period), deadline);
  });
  taxPeriodsFor('3', year).forEach(({ key: period }) => { const deadline = calculatedTaxDeadline('3', 'unified', period);
    addDeadline({ id: `tax-g3:${period}`, note: 'Останній день для сплати ЄП та ВЗ по 3 групі', source: 'tax', target: `tax|3|${period}` }, statutoryTaxDeadline('3', 'unified', period), deadline);
  });
  taxPeriodsFor('3', year).forEach(({ key: period }) => { const deadline = calculatedTaxDeadline('3', 'esv', period);
    addDeadline({ id: `tax-esv:${period}`, note: 'Останній день для сплати ЄСВ', source: 'tax', target: `tax|3|${period}` }, statutoryTaxDeadline('3', 'esv', period), deadline);
  });
  reportPeriodsFor('1', year).forEach(({ key: period }) => { const deadline = getDefaultReportDeadline(db, '1', period);
    addDeadline({ id: `report-annual:${period}`, note: 'Річна звітність', source: 'report' }, statutoryReportDeadline('1', period), deadline);
  });
  reportPeriodsFor('3', year).forEach(({ key: period }) => { const deadline = getDefaultReportDeadline(db, '3', period);
    addDeadline({ id: `report-quarterly:${period}`, note: 'Квартальна звітність', source: 'report' }, statutoryReportDeadline('3', period), deadline);
  });
  const propertyIncomeDeadline = annualPropertyIncomeDeclarationDeadline(year);
  if (propertyIncomeDeadline.startsWith(prefix)) events.push({ id: `report-property-income:${year}`, eventDate: propertyIncomeDeadline, note: 'Декларація про майновий стан і доходи', source: 'report' });
  Array.from({ length: 12 }, (_, index) => index + 1).forEach((payMonth) => {
    const period = `${year}-${pad(payMonth)}`;
    const dates = payrollDatesForPeriod(getSettings(), period);
    [['secondHalf', 'Виплата зарплати за другу половину попереднього місяця'], ['firstHalf', 'Виплата зарплати за першу половину поточного місяця']].forEach(([part, note]) => {
      const eventDate = dates[part];
      if (eventDate?.startsWith(prefix)) events.push({ id: `salary:${period}:${part}`, eventDate, note, source: 'salary' });
    });
  });
  return events;
}

function sectionTabs(section) {
  return `<div class="section-tabs calendar-tabs"><button class="${section === 'calendar' ? 'active' : ''}" data-calendar-section="calendar">Календар</button><button class="${section === 'tasks' ? 'active' : ''}" data-calendar-section="tasks">Задачі</button></div>`;
}

function renderTasks(year, fallbackDate) {
  const date = uiState.calendarTaskDate || fallbackDate;
  const tasks = calendarTasksForDate(date);
  const weekday = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П’ятниця', 'Субота'][dateFromIso(date).getDay()];
  return `<div class="calendar-sticky">${sectionTabs('tasks')}<div class="toolbar"><div class="toolbar-actions calendar-task-nav"><button class="secondary" data-calendar-task-prev aria-label="Попередній день">←</button><input class="calendar-task-date" type="date" value="${date}" aria-label="Обрати дату задач" data-calendar-task-date-picker><button class="secondary" data-calendar-task-next aria-label="Наступний день">→</button><button class="secondary" data-calendar-today>Сьогодні</button></div></div><p class="calendar-task-day">${weekday}</p></div>
    <div class="task-list">${tasks.length ? tasks.map((event) => {
      const completed = isTaskComplete(event);
      const subtasks = event.subtasks || [];
      const eventId = escapeHtml(event.seriesId || event.id);
      const occurrenceDate = escapeHtml(event.occurrenceDate || event.eventDate);
      return `<div class="task-group"><div class="task-row${completed ? ' completed' : ''}"><button type="button" class="task-check" data-calendar-task-toggle="${eventId}" data-calendar-task-date="${occurrenceDate}" aria-label="Позначити виконання">${completed ? '✓' : ''}</button><button type="button" class="task-content" data-calendar-event="${eventId}" data-calendar-occurrence="${occurrenceDate}"><strong>${escapeHtml(noteTitle(event))}</strong><span>${event.clientId ? escapeHtml(clientName(event.clientId)) : 'Без ФОП'}${event.eventTime ? ` · ${escapeHtml(event.eventTime)}` : ''}${event.recurring ? ' · регулярна' : ' · разова'}</span>${event.note ? `<p>${escapeHtml(event.note)}</p>` : ''}</button><button type="button" class="subtask-add" data-add-subtask="${eventId}" data-add-subtask-date="${occurrenceDate}" title="Додати підзадачу">+ Підзадача</button></div>${subtasks.length ? `<div class="task-subtasks">${subtasks.map((subtask) => { const done = isSubtaskComplete(event, subtask); const subtaskId = escapeHtml(subtask.id); return `<div class="subtask-row${done ? ' completed' : ''}"><button type="button" class="subtask-check" data-calendar-subtask-toggle="${eventId}" data-calendar-subtask-id="${subtaskId}" data-calendar-subtask-date="${occurrenceDate}" aria-label="Позначити підзадачу виконаною">${done ? '✓' : ''}</button><span>${escapeHtml(subtask.title)}</span><button type="button" class="subtask-delete" data-delete-subtask="${eventId}" data-delete-subtask-id="${subtaskId}" title="Видалити підзадачу" aria-label="Видалити підзадачу">×</button></div>`; }).join('')}</div>` : ''}</div>`;
    }).join('') : '<p class="empty">На цей день задач немає.</p>'}</div>`;
}

export function renderCalendar() {
  const year = getSettings().workingYear;
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (!uiState.calendarMonth) uiState.calendarMonth = new Date().getFullYear() === year ? new Date().getMonth() + 1 : 1;
  const month = uiState.calendarMonth;
  const section = uiState.calendarSection || 'calendar';
  const defaultTaskDate = new Date().getFullYear() === year ? `${year}-${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}` : `${year}-${pad(month)}-01`;
  if (section === 'tasks') return renderTasks(year, defaultTaskDate);
  const events = [...recurringEventsForMonth(getCalendarEvents(), year, month), ...derivedEvents(year, month)].sort((a, b) => String(a.eventTime || '').localeCompare(String(b.eventTime || '')) || String(a.note).localeCompare(String(b.note), 'uk'));
  const firstDay = new Date(year, month - 1, 1).getDay() || 7;
  const days = new Date(year, month, 0).getDate();
  const cells = Array.from({ length: firstDay - 1 }, () => '<div class="calendar-cell blank"></div>');
  for (let day = 1; day <= days; day += 1) {
    const date = `${year}-${pad(month)}-${pad(day)}`;
    const dayEvents = events.filter((item) => item.eventDate === date);
    const weekend = new Date(year, month - 1, day).getDay() % 6 === 0;
    cells.push(`<div class="calendar-cell${date === today ? ' today' : ''}${weekend ? ' weekend' : ''}" data-calendar-day="${escapeHtml(date)}" role="button" tabindex="0"><strong>${day}</strong>${dayEvents.map((item) => { const eventId = escapeHtml(item.seriesId || item.id); return `<div class="calendar-event-row"><button class="calendar-event ${escapeHtml(item.source || 'note')}${item.transferRole ? ` deadline-${item.transferRole}` : ''}" data-calendar-event="${eventId}" data-calendar-occurrence="${escapeHtml(item.occurrenceDate || item.eventDate)}" data-calendar-target="${escapeHtml(item.target || '')}" data-transfer-id="${escapeHtml(item.transferId || '')}" data-transfer-role="${escapeHtml(item.transferRole || '')}" title="${escapeHtml(item.note)}">${item.eventTime ? `${escapeHtml(item.eventTime)} ` : ''}${item.recurring ? '↻ ' : ''}${escapeHtml(eventLabel(item))}</button>${item.source ? '' : `<button class="icon calendar-delete" data-delete-note="${eventId}" data-delete-note-recurring="${item.recurring ? 'true' : ''}" title="Видалити ${item.recurring ? 'всю серію задач' : 'задачу'}">×</button>`}</div>`; }).join('')}</div>`);
  }
  return `<div class="calendar-sticky">${sectionTabs(section)}<div class="toolbar"><div class="toolbar-actions"><button class="secondary" data-calendar-prev>←</button><strong class="calendar-period">${MONTH_NAMES_UA[month - 1]} ${year}</strong><button class="secondary" data-calendar-next>→</button><button class="secondary" data-calendar-today>Сьогодні</button></div></div></div>
    <div class="calendar-weekdays"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Нд</span></div><div class="calendar-grid">${cells.join('')}<svg class="calendar-transfer-layer" aria-hidden="true"></svg></div>`;
}
