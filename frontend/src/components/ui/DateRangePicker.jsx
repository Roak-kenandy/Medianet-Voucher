import { useEffect, useRef, useState } from 'react';
import {
  DateField,
  DateInput as AriaDateInput,
  DateSegment,
  I18nProvider,
  RangeCalendar,
} from 'react-aria-components';
import { CalendarDays, X } from 'lucide-react';
import Popover, { useMediaQuery } from './Popover';
import CalendarMonths from './CalendarMonths';
import {
  DATE_LOCALE,
  displayDate,
  rangePresets,
  toCalendarDate,
  toDateString,
  todayDate,
} from './datePickerUtils';
import './ui-controls.css';

function SegmentField({ label, value, onChange }) {
  return (
    <DateField value={value} onChange={onChange} aria-label={label} className="ui-date-field">
      <AriaDateInput className="ui-date-field-input">
        {(segment) => <DateSegment segment={segment} className="ui-date-segment" />}
      </AriaDateInput>
    </DateField>
  );
}

function sameRange(a, b) {
  return a?.start && b?.start && a.start.compare(b.start) === 0 && a.end.compare(b.end) === 0;
}

/**
 * One field for a start/end date filter. Values are 'YYYY-MM-DD' strings (empty = no limit);
 * onChange receives { startDate, endDate } when the user clicks Apply or clears the field.
 */
export default function DateRangePicker({
  id,
  startDate,
  endDate,
  onChange,
  placeholder = 'Select dates',
  clearable = true,
  disabled = false,
}) {
  const anchorRef = useRef(null);
  const narrow = useMediaQuery('(max-width: 760px)');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [focusedDate, setFocusedDate] = useState(todayDate());

  const openPicker = () => {
    if (disabled) return;
    const start = toCalendarDate(startDate);
    const end = toCalendarDate(endDate) || start;
    const range = start ? { start, end } : null;
    setDraft(range);
    setFocusedDate((narrow ? range?.end : range?.start) || todayDate());
    setOpen(true);
  };

  useEffect(() => {
    if (!open || !narrow) return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector('.ui-range-preset.is-active')
        ?.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, narrow]);

  const apply = () => {
    if (!draft?.start) return;
    onChange?.({ startDate: toDateString(draft.start), endDate: toDateString(draft.end || draft.start) });
    setOpen(false);
  };

  const pickPreset = (preset) => {
    setDraft({ start: preset.start, end: preset.end });
    setFocusedDate(narrow ? preset.end : preset.start);
  };

  const updateEdge = (edge, value) => {
    if (!value) return;
    const next = { start: draft?.start || value, end: draft?.end || value, [edge]: value };
    if (next.start.compare(next.end) > 0) {
      if (edge === 'start') next.end = value;
      else next.start = value;
    }
    setDraft(next);
    setFocusedDate(value);
  };

  const label = startDate || endDate
    ? `${displayDate(startDate) || 'Any'} – ${displayDate(endDate) || 'Any'}`
    : '';

  return (
    <I18nProvider locale={DATE_LOCALE}>
      <button
        id={id}
        ref={anchorRef}
        type="button"
        className={`form-input ui-date-trigger${open ? ' is-open' : ''}`}
        onClick={() => (open ? setOpen(false) : openPicker())}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarDays size={16} className="ui-date-trigger-icon" aria-hidden="true" />
        <span className={label ? 'ui-date-trigger-value' : 'ui-date-trigger-placeholder'}>
          {label || placeholder}
        </span>
        {clearable && label && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            className="ui-date-trigger-clear"
            onClick={(event) => {
              event.stopPropagation();
              onChange?.({ startDate: '', endDate: '' });
            }}
            aria-label="Clear dates"
          >
            <X size={14} />
          </span>
        )}
      </button>

      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} className="ui-range-popover">
        <div className="ui-range-presets" role="listbox" aria-label="Quick ranges">
          {rangePresets().map((preset) => (
            <button
              key={preset.label}
              type="button"
              role="option"
              aria-selected={Boolean(sameRange(draft, preset))}
              className={`ui-range-preset${sameRange(draft, preset) ? ' is-active' : ''}`}
              onClick={() => pickPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="ui-range-main">
          <RangeCalendar
            aria-label="Date range"
            value={draft}
            onChange={setDraft}
            focusedValue={focusedDate}
            onFocusChange={setFocusedDate}
            visibleDuration={{ months: narrow ? 1 : 2 }}
            className="ui-cal ui-cal-range"
          >
            <CalendarMonths months={narrow ? 1 : 2} />
          </RangeCalendar>

          <div className="ui-range-footer">
            <div className="ui-range-inputs">
              <SegmentField label="Start date" value={draft?.start ?? null} onChange={(v) => updateEdge('start', v)} />
              <span className="ui-range-dash">–</span>
              <SegmentField label="End date" value={draft?.end ?? null} onChange={(v) => updateEdge('end', v)} />
            </div>
            <div className="ui-range-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={apply} disabled={!draft?.start}>
                Apply
              </button>
            </div>
          </div>
        </div>
      </Popover>
    </I18nProvider>
  );
}
