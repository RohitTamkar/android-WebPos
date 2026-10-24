import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import './ReportDateInput.css';
import './ReportMonthInput.css';

interface ReportMonthInputProps {
  value: string;
  onChange: (value: string) => void;
  'aria-label'?: string;
}

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthId = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

function parseMonth(value: string): Date | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1, 12);
}

export function ReportMonthInput({ value, onChange, 'aria-label': label = 'Month and year' }: ReportMonthInputProps) {
  const calendarId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const selected = parseMonth(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => selected ?? new Date());
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });
  const today = monthId(new Date());
  const display = selected?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) ?? 'Choose month';
  const years = Array.from({ length: 121 }, (_, index) => new Date().getFullYear() - 100 + index);
  if (!years.includes(view.getFullYear())) years.push(view.getFullYear());

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const show = () => {
    setView(selected ?? new Date());
    setOpen(true);
  };
  const choose = (month: string) => {
    onChange(month);
    close(true);
  };
  const changeView = (year: number, month: number) => setView(new Date(year, month, 1, 12));

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 24);
      const height = calendarRef.current?.offsetHeight || 330;
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
    const outside = (event: Event) => {
      if (event.target instanceof Node && !calendarRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  return <div className="report-date-control">
    <button ref={triggerRef} type="button" className={`report-date-trigger${selected ? '' : ' is-empty'}`}
      aria-label={`${label}: ${display}`} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? calendarId : undefined}
      onClick={() => open ? close() : show()}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(); } }}>
      <CalendarDays aria-hidden="true" /><span>{display}</span><ChevronDown aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={calendarRef} id={calendarId} className="report-date-calendar report-month-calendar" role="dialog"
      aria-label={`${label} calendar`} style={{ top: position.top, left: position.left, width: position.width }}>
      <div className="report-date-caption"><CalendarDays aria-hidden="true" /><span>{label}</span><small>MMM YYYY</small></div>
      <div className="report-date-navigation">
        <button type="button" aria-label="Previous year" onClick={() => changeView(view.getFullYear() - 1, view.getMonth())}><ChevronLeft /></button>
        <div className="report-date-month-selects">
          <select aria-label="Month" value={view.getMonth()} onChange={event => changeView(view.getFullYear(), Number(event.target.value))}>
            {months.map((month, index) => <option key={month} value={index}>{month}</option>)}
          </select>
          <select aria-label="Year" value={view.getFullYear()} onChange={event => changeView(Number(event.target.value), view.getMonth())}>
            {years.sort((a, b) => a - b).map(year => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
        <button type="button" aria-label="Next year" onClick={() => changeView(view.getFullYear() + 1, view.getMonth())}><ChevronRight /></button>
      </div>
      <div className="report-month-grid" role="group" aria-label="Select a month">
        {months.map((month, index) => {
          const key = `${view.getFullYear()}-${String(index + 1).padStart(2, '0')}`;
          return <button type="button" key={key} aria-pressed={key === value} aria-label={month}
            className={[key === value ? 'is-selected' : '', key === today ? 'is-current' : ''].join(' ')}
            onClick={() => choose(key)}>{month.slice(0, 3)}</button>;
        })}
      </div>
      <div className="report-date-footer"><span>{display}</span><button type="button" onClick={() => choose(today)}>This month</button></div>
    </div>, document.body)}
  </div>;
}
