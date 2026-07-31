import { escapeHtml, MONTH_NAMES_UA } from '../utils';
import { db, getCalendarEvents, getSettings } from '../state.js';
import { uiState } from '../ui-state.js';
import { calculatedTaxDeadline, taxPeriodsFor } from '../tax-model.ts';
import { reportPeriodsFor, getDefaultReportDeadline } from '../report-model.ts';

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
function previousWorkday(year, month, day) { const date = new Date(year, month - 1, day); if (date.getDay() === 6) date.setDate(date.getDate() - 1); if (date.getDay() === 0) date.setDate(date.getDate() - 2); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
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
  taxPeriodsFor('1', year).forEach(({ key: period }) => { const deadline = calculatedTaxDeadline('1', 'unified', period);
    if (deadline?.startsWith(prefix)) events.push({ id: `tax-default:${period}`, eventDate: deadline, note: 'Останній день для сплати ЄП та ВЗ по 2 групі', source: 'tax', target: `tax|12|${period}` });
  });
  taxPeriodsFor('3', year).forEach(({ key: period }) => { const deadline = calculatedTaxDeadline('3', 'unified', period);
    if (deadline?.startsWith(prefix)) events.push({ id: `tax-g3:${period}`, eventDate: deadline, note: 'Останній день для сплати ЄП та ВЗ по 3 групі', source: 'tax', target: `tax|3|${period}` });
  });
  taxPeriodsFor('3', year).forEach(({ key: period }) => { const deadline = calculatedTaxDeadline('3', 'esv', period);
    if (deadline?.startsWith(prefix)) events.push({ id: `tax-esv:${period}`, eventDate: deadline, note: 'Останній день для сплати ЄСВ', source: 'tax', target: `tax|3|${period}` });
  });
  reportPeriodsFor('1', year).forEach(({ key: period }) => { const deadline = getDefaultReportDeadline(db, '1', period);
    if (deadline?.startsWith(prefix)) events.push({ id: `report-annual:${period}`, eventDate: deadline, note: 'Дедлайн: річна звітність', source: 'report' });
  });
  reportPeriodsFor('3', year).forEach(({ key: period }) => { const deadline = getDefaultReportDeadline(db, '3', period);
    if (deadline?.startsWith(prefix)) events.push({ id: `report-quarterly:${period}`, eventDate: deadline, note: 'Дедлайн: квартальна звітність', source: 'report' });
  });
  Array.from({ length: 12 }, (_, index) => index + 1).forEach((payMonth) => [7, 21].forEach((day) => {
    const eventDate = previousWorkday(year, payMonth, day);
    if (eventDate.startsWith(prefix)) events.push({ id: `salary:${payMonth}:${day}`, eventDate, note: 'День виплати зарплати', source: 'salary' });
  }));
  return events;
}

function sectionTabs(section) {
  return `<div class="section-tabs calendar-tabs"><button class="${section === 'calendar' ? 'active' : ''}" data-calendar-section="calendar">Календар</button><button class="${section === 'tasks' ? 'active' : ''}" data-calendar-section="tasks">Задачі</button></div>`;
}

function renderTasks(year, fallbackDate) {
  const date = uiState.calendarTaskDate || fallbackDate;
  const tasks = calendarTasksForDate(date);
  const weekday = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П’ятниця', 'Субота'][dateFromIso(date).getDay()];
  return `<div class="calendar-sticky">${sectionTabs('tasks')}<div class="toolbar"><div class="toolbar-actions calendar-task-nav"><button class="secondary" data-calendar-task-prev aria-label="Попередній день">←</button><input class="calendar-task-date" type="date" value="${date}" aria-label="Обрати дату задач" data-calendar-task-date-picker><button class="secondary" data-calendar-task-next aria-label="Наступний день">→</button></div></div><p class="calendar-task-day">${weekday}</p></div>
    <div class="task-list">${tasks.length ? tasks.map((event) => {
      const completed = isTaskComplete(event);
      const subtasks = event.subtasks || [];
      return `<div class="task-group"><div class="task-row${completed ? ' completed' : ''}"><button type="button" class="task-check" data-calendar-task-toggle="${event.seriesId || event.id}" data-calendar-task-date="${event.occurrenceDate || event.eventDate}" aria-label="Позначити виконання">${completed ? '✓' : ''}</button><button type="button" class="task-content" data-calendar-event="${event.seriesId || event.id}" data-calendar-occurrence="${event.occurrenceDate || event.eventDate}"><strong>${escapeHtml(noteTitle(event))}</strong><span>${event.clientId ? escapeHtml(clientName(event.clientId)) : 'Без ФОП'}${event.eventTime ? ` · ${escapeHtml(event.eventTime)}` : ''}${event.recurring ? ' · регулярна' : ' · разова'}</span>${event.note ? `<p>${escapeHtml(event.note)}</p>` : ''}</button><button type="button" class="subtask-add" data-add-subtask="${event.seriesId || event.id}" data-add-subtask-date="${event.occurrenceDate || event.eventDate}" title="Додати підзадачу">+ Підзадача</button></div>${subtasks.length ? `<div class="task-subtasks">${subtasks.map((subtask) => { const done = isSubtaskComplete(event, subtask); return `<div class="subtask-row${done ? ' completed' : ''}"><button type="button" class="subtask-check" data-calendar-subtask-toggle="${event.seriesId || event.id}" data-calendar-subtask-id="${subtask.id}" data-calendar-subtask-date="${event.occurrenceDate || event.eventDate}" aria-label="Позначити підзадачу виконаною">${done ? '✓' : ''}</button><span>${escapeHtml(subtask.title)}</span><button type="button" class="subtask-delete" data-delete-subtask="${event.seriesId || event.id}" data-delete-subtask-id="${subtask.id}" title="Видалити підзадачу" aria-label="Видалити підзадачу">×</button></div>`; }).join('')}</div>` : ''}</div>`;
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
    cells.push(`<div class="calendar-cell${date === today ? ' today' : ''}${weekend ? ' weekend' : ''}" data-calendar-day="${date}" role="button" tabindex="0"><strong>${day}</strong>${dayEvents.map((item) => `<div class="calendar-event-row"><button class="calendar-event ${item.source || 'note'}" data-calendar-event="${item.seriesId || item.id}" data-calendar-occurrence="${item.occurrenceDate || item.eventDate}" data-calendar-target="${item.target || ''}" title="${escapeHtml(item.note)}">${item.eventTime ? `${escapeHtml(item.eventTime)} ` : ''}${item.recurring ? '↻ ' : ''}${escapeHtml(eventLabel(item))}</button>${item.source ? '' : `<button class="icon calendar-delete" data-delete-note="${item.seriesId || item.id}" data-delete-note-recurring="${item.recurring ? 'true' : ''}" title="Видалити ${item.recurring ? 'всю серію задач' : 'задачу'}">×</button>`}</div>`).join('')}</div>`);
  }
  return `<div class="calendar-sticky">${sectionTabs(section)}<div class="toolbar"><div class="toolbar-actions"><button class="secondary" data-calendar-prev>←</button><strong class="calendar-period">${MONTH_NAMES_UA[month - 1]} ${year}</strong><button class="secondary" data-calendar-next>→</button></div></div></div>
    <div class="calendar-weekdays"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Нд</span></div><div class="calendar-grid">${cells.join('')}</div>`;
}
