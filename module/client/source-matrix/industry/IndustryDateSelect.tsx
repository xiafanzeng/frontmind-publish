import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@frontmind/module-ui/components/ui/popover';
import { formatIndustryDate, industryDateOptions, industryDayCalendar, isIndustryDateValueAvailable, moveIndustryDayFocus, INDUSTRY_DATE_PERIODS, type IndustryDatePeriod, type IndustryDateValue } from './industry-date';
import './IndustryDateSelect.css';

type Props = {
  id?: string; value: IndustryDateValue; minDate: string | null; maxDate: string | null;
  onChange: (value: IndustryDateValue) => void; disabled?: boolean; ariaLabel?: string; modal?: boolean;
};

function IndustryDayCalendar({ id, value, minDate, maxDate, onSelect }: Pick<Props, 'value' | 'minDate' | 'maxDate'> & { id: string; onSelect: (date: string) => void }) {
  const selectedDate = value.periodType === 'DAY' && isIndustryDateValueAvailable(value, minDate, maxDate) ? value.date : null;
  const initialDate = selectedDate ?? maxDate;
  const [browseMonth, setBrowseMonth] = useState(initialDate);
  const [focusDate, setFocusDate] = useState(initialDate);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const calendar = useMemo(() => industryDayCalendar(browseMonth, minDate, maxDate), [browseMonth, minDate, maxDate]);
  useEffect(() => {
    setBrowseMonth(initialDate); setFocusDate(initialDate); pendingFocus.current = null;
  }, [initialDate, minDate, maxDate]);
  useEffect(() => {
    if (pendingFocus.current) { dayRefs.current.get(pendingFocus.current)?.focus(); pendingFocus.current = null; }
  }, [calendar?.month, focusDate]);
  if (!calendar) return <div className="fm-industry-date-empty" role="status">暂无可选日期</div>;
  const activeDate = focusDate && focusDate >= calendar.firstSelectable && focusDate <= calendar.lastSelectable ? focusDate : calendar.firstSelectable;
  const focusDay = (date: string) => {
    pendingFocus.current = date; setBrowseMonth(date); setFocusDate(date);
    if (date === activeDate) { dayRefs.current.get(date)?.focus(); pendingFocus.current = null; }
  };
  const changeMonth = (month: string | null) => {
    if (!month) return;
    const next = industryDayCalendar(month, minDate, maxDate);
    if (next) focusDay(next.firstSelectable);
  };
  const dayKey = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const next = moveIndustryDayFocus(date, event.key, minDate, maxDate);
    if (!next) return;
    event.preventDefault(); focusDay(next);
  };
  return <div className="fm-industry-day-calendar">
    <div className="fm-industry-day-header">
      <button type="button" className="fm-industry-day-month-nav" aria-label="上个月" disabled={!calendar.previousMonth} onClick={() => changeMonth(calendar.previousMonth)}><ChevronLeft size={18} aria-hidden="true"/></button>
      <span id={`${id}-month`} className="fm-industry-day-month-title" aria-live="polite">{calendar.label}</span>
      <button type="button" className="fm-industry-day-month-nav" aria-label="下个月" disabled={!calendar.nextMonth} onClick={() => changeMonth(calendar.nextMonth)}><ChevronRight size={18} aria-hidden="true"/></button>
    </div>
    <div className="fm-industry-day-grid" role="grid" aria-labelledby={`${id}-month`} aria-describedby={`${id}-range`}>
      <div className="fm-industry-day-weekdays" role="row">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day} role="columnheader" aria-label={`星期${day}`}>{day}</span>)}</div>
      {calendar.weeks.map((week, index) => <div className="fm-industry-day-week" role="row" key={index}>{week.map((date, column) => {
        if (!date) return <div className="fm-industry-day-cell" role="gridcell" key={column}><span className="fm-industry-day-blank" aria-hidden="true"/></div>;
        const selected = date === selectedDate, unavailable = date < calendar.firstSelectable || date > calendar.lastSelectable;
        return <div className="fm-industry-day-cell" role="gridcell" aria-selected={selected} key={date}>
          <button type="button" className="fm-industry-day" ref={node => { if (node) dayRefs.current.set(date, node); else dayRefs.current.delete(date); }}
            aria-label={`选择${date}`} aria-pressed={selected} disabled={unavailable} tabIndex={date === activeDate && !unavailable ? 0 : -1}
            onFocus={() => setFocusDate(date)} onKeyDown={event => dayKey(event, date)} onClick={() => onSelect(date)}>{Number(date.slice(8))}</button>
        </div>;
      })}</div>)}
    </div>
    <div id={`${id}-range`} className="fm-industry-day-range">{calendar.rangeLabel}</div>
  </div>;
}

/** Shared by the applied page filters and the independent export draft. */
export function IndustryDateSelect({ id, value, minDate, maxDate, onChange, disabled, ariaLabel = '日期', modal = false }: Props) {
  const generatedId = useId(), controlId = id ?? generatedId;
  const [open, setOpen] = useState(false), [browsePeriod, setBrowsePeriod] = useState(value.periodType);
  const [visibleCount, setVisibleCount] = useState(80);
  const tabRefs = useRef<Partial<Record<IndustryDatePeriod, HTMLButtonElement | null>>>({});
  const list = useRef<HTMLUListElement>(null);
  const { options, hasMore } = useMemo(() => industryDateOptions(browsePeriod, minDate, maxDate, 0, visibleCount), [browsePeriod, minDate, maxDate, visibleCount]);
  const browse = (period: IndustryDatePeriod) => { setBrowsePeriod(period); setVisibleCount(80); if (list.current) list.current.scrollTop = 0; };
  const changeOpen = (next: boolean) => { if (next) browse(value.periodType); setOpen(next); };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % INDUSTRY_DATE_PERIODS.length;
    else if (event.key === 'ArrowLeft') next = (index + INDUSTRY_DATE_PERIODS.length - 1) % INDUSTRY_DATE_PERIODS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = INDUSTRY_DATE_PERIODS.length - 1;
    else return;
    event.preventDefault(); const period = INDUSTRY_DATE_PERIODS[next]!.value; browse(period); tabRefs.current[period]?.focus();
  };
  return <Popover open={open} onOpenChange={changeOpen} modal={modal}>
    <PopoverTrigger asChild><button id={controlId} type="button" className="fm-industry-date-trigger" disabled={disabled} aria-label={`${ariaLabel}：${maxDate ? formatIndustryDate(value) : '暂无可选周期'}`}>
      <span>{maxDate ? formatIndustryDate(value) : '暂无可选周期'}</span><ChevronDown size={16} aria-hidden="true"/>
    </button></PopoverTrigger>
    <PopoverContent className="fm-industry-date-popover" align="end" sideOffset={10} collisionPadding={16} aria-label="选择日期周期" onOpenAutoFocus={event => { event.preventDefault(); tabRefs.current[value.periodType]?.focus(); }}>
      <div className="fm-industry-date-tabs" role="tablist" aria-label="日期粒度">{INDUSTRY_DATE_PERIODS.map((period, index) => <button
        key={period.value} id={`${controlId}-${period.value}`} ref={node => { tabRefs.current[period.value] = node; }} type="button" role="tab"
        aria-selected={browsePeriod === period.value} aria-controls={`${controlId}-options`} tabIndex={browsePeriod === period.value ? 0 : -1}
        onKeyDown={event => tabKey(event, index)} onClick={() => browse(period.value)}>{period.label}</button>)}</div>
      <div id={`${controlId}-options`} role="tabpanel" aria-labelledby={`${controlId}-${browsePeriod}`}>
        {browsePeriod === 'DAY' ? <IndustryDayCalendar id={controlId} value={value} minDate={minDate} maxDate={maxDate} onSelect={date => {
          setOpen(false);
          if (value.periodType !== 'DAY' || value.date !== date) onChange({ periodType: 'DAY', date });
        }}/> : <ul ref={list} className="fm-industry-date-options" onScroll={event => {
          const element = event.currentTarget;
          if (hasMore && element.scrollHeight - element.scrollTop - element.clientHeight < 120) setVisibleCount(count => count + 80);
        }} onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0 || !buttons.length) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
          if (hasMore && next >= buttons.length - 1) setVisibleCount(count => count + 80);
          buttons[next]?.focus();
        }}>{options.length ? options.map(option => {
          const selected = value.periodType === option.periodType && value.date === option.date;
          const partial = option.availableStart !== option.start || option.availableEnd !== option.end;
          const compactRange = (start: string, end: string) => `${start.slice(5)} ~ ${end.slice(5)}`;
          return <li key={option.date}><button type="button" aria-label={`选择${option.label}`} aria-pressed={selected}
            title={`${option.start} 至 ${option.end}${partial ? option.availableStart ? `；可用日期 ${option.availableStart} 至 ${option.availableEnd}` : `；数据截至 ${option.availableEnd}，起始范围未提供` : ''}`}
            onClick={() => { setOpen(false); if (!selected) onChange({ periodType: option.periodType, date: option.date }); }}>
            <span className="fm-industry-date-option-main"><span>{option.label}</span><span className="fm-industry-date-range">{compactRange(option.start, option.end)}</span>
              {partial && <small>{option.availableStart ? `可用日期 ${compactRange(option.availableStart, option.availableEnd)}` : `数据截至 ${option.availableEnd.slice(5)}`}</small>}</span>
            {selected && <Check size={18} aria-hidden="true"/>}
          </button></li>;
        }) : <li className="fm-industry-date-empty">暂无可选周期</li>}</ul>}
      </div>
    </PopoverContent>
  </Popover>;
}
