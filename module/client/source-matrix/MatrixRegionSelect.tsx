import { useId, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@frontmind/module-ui/components/ui/popover';
import { mediaCoverageProvinces } from '../../shared/media-catalog-filters';
import { matrixRegionDraft, normalizeMatrixRegions } from '../../shared/matrix-requirements';
import './matrix-region-select.css';

export function MatrixRegionSelect({ value, unrestricted, onChange }: { value: string; unrestricted?: boolean; onChange: (value: string, unrestricted: boolean) => void }) {
  const state = matrixRegionDraft(value, unrestricted), selected = normalizeMatrixRegions(state.regions);
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const id = useId(), search = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [tokens, setTokens] = useState<CSSProperties>({});
  const options = mediaCoverageProvinces.filter(province => province.includes(query.trim()));
  const legacy = selected.filter(province => !mediaCoverageProvinces.includes(province));
  const changeOpen = (next: boolean) => {
    if (next && trigger.current) {
      const style = getComputedStyle(trigger.current);
      setTokens({ ...Object.fromEntries(['ink', 'muted', 'line', 'surface', 'canvas', 'brand'].map(name => [`--sm-region-${name}`, style.getPropertyValue(`--${name}`)])), '--sm-region-font': style.fontFamily } as CSSProperties);
      setQuery('');
    }
    setOpen(next);
  };
  return <div className="sm-region-field"><label htmlFor={id}>覆盖地区</label><Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild><button id={id} ref={trigger} type="button" className="sm-region-trigger" aria-label="覆盖地区"><span>{state.regionsUnrestricted ? '不限地区' : selected.length ? selected.join('、') : '选择省份'}</span><ChevronDown size={16} aria-hidden="true"/></button></PopoverTrigger>
    <PopoverContent className="sm-region-popover" style={tokens} aria-label="选择覆盖地区" align="start" collisionPadding={16} onOpenAutoFocus={event => { event.preventDefault(); search.current?.focus(); }}>
      <label className="sm-region-unlimited"><input type="checkbox" checked={state.regionsUnrestricted} onChange={event => onChange('', event.target.checked)}/>不限地区</label>
      <div className="sm-region-search"><input ref={search} aria-label="搜索省份" placeholder="搜索省份" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'ArrowDown' && !event.nativeEvent.isComposing) { event.preventDefault(); list.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus(); } }}/>{query && <button type="button" aria-label="清除省份搜索" onClick={() => { setQuery(''); search.current?.focus(); }}><X size={16} aria-hidden="true"/></button>}</div>
      <p className="sm-region-hint">{state.regionsUnrestricted ? '取消“不限地区”后可选择省份。' : '可多选；未选省份时按不限地区提交。'}</p>
      <div ref={list} className="sm-region-options" role="group" aria-label="省份" onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        const inputs = [...(list.current?.querySelectorAll<HTMLInputElement>('input:not(:disabled)') ?? [])], index = inputs.indexOf(document.activeElement as HTMLInputElement);
        const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? Math.min(index + 1, inputs.length - 1) : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? inputs.length - 1 : null;
        if (next !== null) { event.preventDefault(); inputs[next]?.focus(); }
      }}>{options.map(province => <label key={province}><input type="checkbox" disabled={state.regionsUnrestricted} checked={selected.includes(province)} onChange={event => onChange((event.target.checked ? [...selected, province] : selected.filter(item => item !== province)).join('、'), false)}/>{province}</label>)}</div>
      {!options.length && <p role="status">没有匹配的省份，请修改或清除搜索。</p>}
      {legacy.length > 0 && <div className="sm-region-legacy"><p>原设置（保留）</p>{legacy.map(region => <span key={region}>{region}<button type="button" aria-label={`移除原地区 ${region}`} onClick={() => onChange(selected.filter(item => item !== region).join('、'), false)}><X size={14} aria-hidden="true"/></button></span>)}</div>}
    </PopoverContent>
  </Popover></div>;
}
