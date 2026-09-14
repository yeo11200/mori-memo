export interface CalendarChoice { id: string; name: string; primary: boolean }
export interface CalendarEvent { id: string; title: string; start: string; end: string; allDay: boolean; url?: string; missing?: boolean }
export interface CalendarSnapshot {
  key: string;
  calendarName: string;
  events: CalendarEvent[];
  rendered: string;
  syncedAt: string;
}
export interface CalendarState {
  configured: boolean;
  connected: boolean;
  calendars: CalendarChoice[];
  selectedIds: string[];
  autoSync: boolean;
  lastSync?: string;
}
export interface CalendarBatch {
  date: string;
  snapshots: Omit<CalendarSnapshot, 'rendered'>[];
}
