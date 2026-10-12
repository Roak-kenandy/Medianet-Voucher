import { useContext } from 'react';
import {
  Button,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  CalendarStateContext,
  RangeCalendarStateContext,
} from 'react-aria-components';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthTitle } from './datePickerUtils';

function cellClassName({
  isSelected,
  isSelectionStart,
  isSelectionEnd,
  isOutsideMonth,
  isDisabled,
  isUnavailable,
  isToday,
  isFocusVisible,
  isHovered,
}) {
  return [
    'ui-cal-cell',
    isSelected && 'is-selected',
    isSelectionStart && 'is-range-start',
    isSelectionEnd && 'is-range-end',
    isOutsideMonth && 'is-outside',
    (isDisabled || isUnavailable) && 'is-disabled',
    isToday && 'is-today',
    isFocusVisible && 'is-focus-visible',
    isHovered && 'is-hovered',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Month grids for a React Aria Calendar / RangeCalendar, laid out side by side with their own titles. */
export default function CalendarMonths({ months = 1 }) {
  const rangeState = useContext(RangeCalendarStateContext);
  const singleState = useContext(CalendarStateContext);
  const state = rangeState || singleState;
  const firstMonth = state.visibleRange.start;

  return (
    <div className="ui-cal-months">
      {Array.from({ length: months }, (_, index) => (
        <div className="ui-cal-month" key={index}>
          <div className="ui-cal-month-header">
            {index === 0 ? (
              <Button slot="previous" className="ui-cal-nav" aria-label="Previous month">
                <ChevronLeft size={18} />
              </Button>
            ) : (
              <span className="ui-cal-nav-spacer" />
            )}
            <span className="ui-cal-month-title">{monthTitle(firstMonth.add({ months: index }))}</span>
            {index === months - 1 ? (
              <Button slot="next" className="ui-cal-nav" aria-label="Next month">
                <ChevronRight size={18} />
              </Button>
            ) : (
              <span className="ui-cal-nav-spacer" />
            )}
          </div>
          <CalendarGrid offset={{ months: index }} className="ui-cal-grid" weekdayStyle="short">
            <CalendarGridHeader>
              {(day) => <CalendarHeaderCell className="ui-cal-weekday">{day.slice(0, 2)}</CalendarHeaderCell>}
            </CalendarGridHeader>
            <CalendarGridBody>
              {(date) => (
                <CalendarCell date={date} className={cellClassName}>
                  {({ formattedDate, isOutsideMonth }) => (
                    <span className="ui-cal-cell-inner">{isOutsideMonth ? '' : formattedDate}</span>
                  )}
                </CalendarCell>
              )}
            </CalendarGridBody>
          </CalendarGrid>
        </div>
      ))}
    </div>
  );
}
