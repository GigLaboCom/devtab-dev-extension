/**
 * The filters of the History page — one HistoryFilter (@workspace/tools-shared/history/filter.ts) that the list, the
 * count, "Export shown" and "Delete shown" all use. Tools and kinds come from the sources (definitions), not from names.
 */
import { dateValue, parseDate } from './format';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import type { HistorySource } from '@src/history/sources';
import type { HistoryFilter } from '@workspace/tools-shared/history';
import type { ReactElement } from 'react';

export type Period = 'hour' | 'day' | 'week' | 'month' | 'all' | 'custom';

export interface FilterState {
  owner: string;
  kind: string;
  period: Period;
  from: string;
  to: string;
  size: string;
  text: string;
}

export const ALL = 'all';
export const INITIAL_FILTER: FilterState = {
  owner: ALL,
  kind: ALL,
  period: 'all',
  from: '',
  to: '',
  size: ALL,
  text: '',
};

const PERIODS: Array<{ value: Period; label: string; ms?: number }> = [
  { value: 'hour', label: 'Last hour', ms: 3_600_000 },
  { value: 'day', label: '24 hours', ms: 86_400_000 },
  { value: 'week', label: '7 days', ms: 7 * 86_400_000 },
  { value: 'month', label: '4 weeks', ms: 28 * 86_400_000 },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Dates' },
];

const SIZES: Array<{ value: string; label: string; min?: number }> = [
  { value: ALL, label: 'Any size' },
  { value: '10k', label: 'Over 10 KB', min: 10 * 1024 },
  { value: '100k', label: 'Over 100 KB', min: 100 * 1024 },
  { value: '1m', label: 'Over 1 MB', min: 1024 * 1024 },
];

/** The filter the state means, at `now`. */
export const filterOf = (state: FilterState, now: number): HistoryFilter => {
  const period = PERIODS.find(p => p.value === state.period);
  const from = state.period === 'custom' ? parseDate(state.from) : period?.ms ? now - period.ms : undefined;
  const toDay = state.period === 'custom' ? parseDate(state.to) : undefined;
  const min = SIZES.find(s => s.value === state.size)?.min;
  return {
    ...(state.owner !== ALL ? { owners: [state.owner] } : {}),
    ...(state.kind !== ALL ? { kinds: [state.kind] } : {}),
    ...(from !== undefined ? { from } : {}),
    // The "to" date is inclusive for people: up to the end of that day.
    ...(toDay !== undefined ? { to: toDay + 86_400_000 } : {}),
    ...(min !== undefined ? { minBytes: min } : {}),
    ...(state.text.trim() ? { text: state.text.trim() } : {}),
  };
};

export const HistoryFilters = ({
  state,
  sources,
  onChange,
  now,
}: {
  state: FilterState;
  sources: readonly HistorySource[];
  onChange: (next: FilterState) => void;
  now: number;
}): ReactElement => {
  const recordable = sources.filter(s => s.declaration.kinds.length > 0);
  const kindSources = state.owner === ALL ? recordable : recordable.filter(s => s.owner === state.owner);
  const kinds = new Map<string, string>();
  for (const s of kindSources) for (const k of s.declaration.kinds) if (!kinds.has(k.id)) kinds.set(k.id, k.title);
  const set = (patch: Partial<FilterState>) => onChange({ ...state, ...patch });
  return (
    <div className="kit-history-filters" role="search" aria-label="Filter the history">
      <div className="kit-history-filter">
        <Label htmlFor="history-owner">Tool</Label>
        <Select value={state.owner} onValueChange={owner => set({ owner, kind: ALL })}>
          <SelectTrigger id="history-owner" className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All tools</SelectItem>
            {recordable.map(s => (
              <SelectItem key={s.owner} value={s.owner}>
                {s.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="kit-history-filter">
        <Label htmlFor="history-kind">Kind</Label>
        <Select value={state.kind} onValueChange={kind => set({ kind })}>
          <SelectTrigger id="history-kind" className="min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All kinds</SelectItem>
            {[...kinds].map(([id, title]) => (
              <SelectItem key={id} value={id}>
                {title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="kit-history-filter">
        <Label htmlFor="history-size">Size</Label>
        <Select value={state.size} onValueChange={size => set({ size })}>
          <SelectTrigger id="history-size" className="min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SIZES.map(s => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="kit-history-filter kit-history-filter-grow">
        <Label htmlFor="history-text">Text</Label>
        <Input
          id="history-text"
          type="search"
          spellCheck={false}
          autoComplete="off"
          placeholder="Search labels and text"
          value={state.text}
          onChange={e => set({ text: e.target.value })}
        />
      </div>
      <div className="kit-history-filter kit-history-filter-wide">
        <span id="history-period" className="kit-history-filter-label">
          Period
        </span>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          aria-labelledby="history-period"
          value={state.period}
          onValueChange={(value: string) => {
            if (!value) return;
            const period = value as Period;
            set(
              period === 'custom' && !state.from
                ? { period, from: dateValue(now - 7 * 86_400_000), to: dateValue(now) }
                : { period },
            );
          }}>
          {PERIODS.map(p => (
            <ToggleGroupItem key={p.value} value={p.value}>
              {p.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {state.period === 'custom' && (
          <div className="kit-history-dates">
            <Label htmlFor="history-from">From</Label>
            <Input id="history-from" type="date" value={state.from} onChange={e => set({ from: e.target.value })} />
            <Label htmlFor="history-to">To</Label>
            <Input id="history-to" type="date" value={state.to} onChange={e => set({ to: e.target.value })} />
          </div>
        )}
      </div>
    </div>
  );
};
