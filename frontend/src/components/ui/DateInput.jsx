import { useRef, useState } from 'react';
import { Calendar, I18nProvider } from 'react-aria-components';
import { CalendarDays, X } from 'lucide-react';
import Popover from './Popover';
import CalendarMonths from './CalendarMonths';
import { DATE_LOCALE, displayDate, toCalendarDate, toDateString, todayDate } from './datePickerUtils';
import './ui-controls.css';

/**
 * Drop-in replacement for <input type="date">: value is 'YYYY-MM-DD' and onChange still receives
 * an event-like object, so callers keep using e.target.value.
 */
export default function DateInput({
  id,
  name,
  value,
  onChange,
  min,
  max,
  required = false,
  disabled = false,
  placeholder = 'Select date',
}) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const selected = toCalendarDate(value);
  const minValue = toCalendarDate(min) || undefined;
  const maxValue = toCalendarDate(max) || undefined;
  const now = todayDate();
  const todayAllowed = (!minValue || now.compare(minValue) >= 0) && (!maxValue || now.compare(maxValue) <= 0);

  const emit = (nextValue) => {
    onChange?.({ target: { value: nextValue, name, id }, currentTarget: { value: nextValue, name, id } });
  };

  return (
    <I18nProvider locale={DATE_LOCALE}>
      <button
        id={id}
        ref={anchorRef}
        type="button"
        className={`form-input ui-date-trigger${open ? ' is-open' : ''}`}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarDays size={16} className="ui-date-trigger-icon" aria-hidden="true" />
        <span className={value ? 'ui-date-trigger-value' : 'ui-date-trigger-placeholder'}>
          {value ? displayDate(value) : placeholder}
        </span>
        {value && !required && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            className="ui-date-trigger-clear"
            onClick={(event) => {
              event.stopPropagation();
              emit('');
            }}
            aria-label="Clear date"
          >
            <X size={14} />
          </span>
        )}
      </button>
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          className="ui-hidden-required"
          value={value || ''}
          onChange={() => {}}
          required
        />
      )}

      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
        <Calendar
          aria-label="Date"
          value={selected}
          onChange={(date) => {
            emit(toDateString(date));
            setOpen(false);
          }}
          defaultFocusedValue={selected || now}
          minValue={minValue}
          maxValue={maxValue}
          className="ui-cal"
        >
          <CalendarMonths months={1} />
        </Calendar>
        <div className="ui-range-footer">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!todayAllowed}
            onClick={() => {
              emit(toDateString(now));
              setOpen(false);
            }}
          >
            Today
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </Popover>
    </I18nProvider>
  );
}
