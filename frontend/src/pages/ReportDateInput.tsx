import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import './ReportDateInput.css';

interface ReportDateInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  'aria-label'?: string;
  disabled?: boolean;
  readOnly?: boolean;
  min?: string;
  max?: string;
  name?: string;
  required?: boolean;
}

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dateId = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && dateId(date) === value ? date : null;
};
const moveMonth = (date: Date, delta: number) => {
  const next = new Date(date.getFullYear(), date.getMonth() + delta, 1, 12);
  next.setDate(Math.min(date.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
  return next;
};

export function ReportDateInput({ value, onChange, id, 'aria-label': label = 'Select date', disabled, readOnly, min, max, name, required }: ReportDateInputProps) {
  const calendarId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => parseDate(value) ?? new Date());
  const [focusDate, setFocusDate] = useState(value || dateId(new Date()));
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });
  const selected = parseDate(value);
  const today = dateId(new Date());
  const allowed = (day: string) => (!min || day >= min) && (!max || day <= max);
  const display = selected ? selected.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Choose date';
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) triggerRef.current?.focus(); };
  const choose = (day: string) => { onChange(day); close(true); };
  const show = () => {
    if (disabled || readOnly) return;
    let date = parseDate(value) ?? new Date();
    if (min && dateId(date) < min) date = parseDate(min) ?? date;
    if (max && dateId(date) > max) date = parseDate(max) ?? date;
    setView(date); setFocusDate(dateId(date)); setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 24);
      const height = calendarRef.current?.offsetHeight || 370;
      const top = rect.bottom + 8 + height <= window.innerHeight - 12
        ? rect.bottom + 8 : Math.max(12, rect.top - height - 8);
      setPosition({ top, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (calendarRef.current?.contains(document.activeElement) && document.activeElement?.tagName === 'SELECT') return;
    calendarRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`)?.focus();
  }, [open, focusDate, view]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !calendarRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(true); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  const navigate = (delta: number) => {
    const next = moveMonth(view, delta);
    setView(next); setFocusDate(dateId(next));
  };
  const onDayKey = (event: KeyboardEvent<HTMLButtonElement>, day: Date) => {
    let next = new Date(day);
    const offset: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -((day.getDay() + 6) % 7), End: 6 - ((day.getDay() + 6) % 7) };
    if (event.key in offset) next.setDate(next.getDate() + offset[event.key]!);
    else if (event.key === 'PageUp' || event.key === 'PageDown') next = moveMonth(day, event.key === 'PageUp' ? -1 : 1);
    else return;
    event.preventDefault();
    if (!allowed(dateId(next))) return;
    setView(next); setFocusDate(dateId(next));
  };
  const first = new Date(view.getFullYear(), view.getMonth(), 1, 12);
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  const years = Array.from({ length: 121 }, (_, index) => new Date().getFullYear() - 100 + index);
  if (!years.includes(view.getFullYear())) years.push(view.getFullYear());

  return <div className="report-date-control">
    {name && <input type="hidden" name={name} value={value} />}
    <button ref={triggerRef} id={id} type="button" className={`report-date-trigger${selected ? '' : ' is-empty'}`} disabled={disabled || readOnly}
      aria-label={`${label}: ${display}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? calendarId : undefined} aria-required={required}
      onClick={() => open ? close() : show()} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(); } }}>
      <CalendarDays aria-hidden="true" /><span>{display}</span><ChevronDown aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={calendarRef} id={calendarId} className="report-date-calendar" role="dialog" aria-label={`${label} calendar`}
      style={{ top: position.top, left: position.left, width: position.width }}>
      <div className="report-date-caption"><CalendarDays aria-hidden="true" /><span>{label}</span><small>DD MMM YYYY</small></div>
      <div className="report-date-navigation">
        <button type="button" aria-label="Previous month" onClick={() => navigate(-1)}><ChevronLeft /></button>
        <div className="report-date-month-selects">
          <select aria-label="Month" value={view.getMonth()} onChange={event => { const next = moveMonth(view, Number(event.target.value) - view.getMonth()); setView(next); setFocusDate(dateId(next)); }}>{months.map((month, index) => <option key={month} value={index}>{month}</option>)}</select>
          <select aria-label="Year" value={view.getFullYear()} onChange={event => { const next = moveMonth(view, (Number(event.target.value) - view.getFullYear()) * 12); setView(next); setFocusDate(dateId(next)); }}>{years.sort((a, b) => a - b).map(year => <option key={year} value={year}>{year}</option>)}</select>
        </div>
        <button type="button" aria-label="Next month" onClick={() => navigate(1)}><ChevronRight /></button>
      </div>
      <div className="report-date-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
      <div className="report-date-days" role="group" aria-label={view.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}>
        {Array.from({ length: 42 }, (_, index) => {
          const day = new Date(first); day.setDate(first.getDate() + index);
          const key = dateId(day);
          return <button type="button" key={key} data-date={key} tabIndex={key === focusDate ? 0 : -1} disabled={!allowed(key)}
            className={[key === value ? 'is-selected' : '', key === today ? 'is-today' : '', day.getMonth() !== view.getMonth() ? 'is-other-month' : ''].join(' ')}
            aria-label={day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} aria-pressed={key === value} aria-current={key === today ? 'date' : undefined}
            onKeyDown={event => onDayKey(event, day)} onClick={() => choose(key)}>{day.getDate()}</button>;
        })}
      </div>
      <div className="report-date-footer"><button type="button" disabled={required} onClick={() => choose('')}>Clear</button><span>{selected ? display : 'Select a date'}</span><button type="button" disabled={!allowed(today)} onClick={() => choose(today)}>Today</button></div>
    </div>, document.body)}
  </div>;
}
