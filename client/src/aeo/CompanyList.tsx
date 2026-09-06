import { Plus } from 'lucide-react';
import type { CompanySummary } from './types';

function when(iso: string | null): string {
  if (!iso) return 'no reading yet';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function CompanyList({
  companies, selectedId, onSelect, onAdd,
}: {
  companies: CompanySummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {companies.map((c) => {
        const active = c.id === selectedId;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={`text-left rounded-input px-3 py-2 transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-bg-alt'}`}
          >
            <div className="flex items-center gap-2">
              <span className={`text-[13.5px] ${active ? 'font-semibold text-ink' : 'text-ink'}`}>{c.name}</span>
              {c.running && <span className="h-2 w-2 rounded-full bg-accent animate-pulse" title="A reading is running" />}
            </div>
            <div className="text-[11.5px] text-ink-light">
              {c.runsMeasured} reading{c.runsMeasured === 1 ? '' : 's'} · last {when(c.lastReadingAt)}
            </div>
          </button>
        );
      })}
      <button type="button" onClick={onAdd} className="text-left rounded-input px-3 py-2 text-[13px] text-ink-mid hover:bg-bg-alt inline-flex items-center gap-1.5">
        <Plus size={14} /> Add a company
      </button>
    </nav>
  );
}
