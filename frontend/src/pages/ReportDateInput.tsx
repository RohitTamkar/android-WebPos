import { useRef, type ComponentProps } from 'react';
import { CalendarDays } from 'lucide-react';
import './ReportDateInput.css';

type ReportDateInputProps = Omit<ComponentProps<'input'>, 'type'>;

export function ReportDateInput({ onClick, ...props }: ReportDateInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const openCalendar = () => {
    const input = inputRef.current;
    if (!input || input.disabled || input.readOnly) return;
    input.focus();
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
      } catch {
        // Keep the native input focused if this browser cannot open its picker.
      }
    }
  };

  return <div className="report-date-control">
    <button type="button" className="report-calendar-button" aria-label={`Open calendar for ${props['aria-label'] || 'report date'}`} disabled={props.disabled || props.readOnly} onClick={openCalendar}><CalendarDays aria-hidden="true" /></button>
    <input {...props} type="date" ref={inputRef} onClick={event => {
      onClick?.(event);
      if (!event.defaultPrevented) openCalendar();
    }} />
  </div>;
}
