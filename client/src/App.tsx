import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { CompanyCard } from './aeo/CompanyCard';
import { CompanyList } from './aeo/CompanyList';
import { SetupForm } from './aeo/SetupForm';
import { StatusStrip } from './aeo/StatusStrip';
import type { CompanySummary, Status } from './aeo/types';

function selectedFromHash(): string | null {
  const m = /company=([^&]+)/.exec(window.location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(selectedFromHash);
  const [adding, setAdding] = useState(false);

  const loadCompanies = useCallback(async () => {
    try {
      const res = await api<{ companies: CompanySummary[] }>('/companies');
      setCompanies(res.companies);
    } catch {
      setCompanies([]);
    }
  }, []);

  useEffect(() => {
    void api<Status>('/status').then(setStatus).catch(() => setStatus(null));
    void loadCompanies();
  }, [loadCompanies]);

  // Fall back to the first company when nothing is selected, so a fresh
  // load lands on a report rather than a blank pane.
  useEffect(() => {
    if (!companies) return;
    if (selectedId && companies.some((c) => c.id === selectedId)) return;
    setSelectedId(companies[0]?.id ?? null);
  }, [companies, selectedId]);

  useEffect(() => {
    window.location.hash = selectedId ? `company=${encodeURIComponent(selectedId)}` : '';
  }, [selectedId]);

  const select = (id: string) => {
    setAdding(false);
    setSelectedId(id);
  };

  const showForm = adding || (companies !== null && companies.length === 0);

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="max-w-[1200px] mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[18px] font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>AEO standing</div>
            <div className="text-[12px] text-ink-light">How a company shows up in AI answers, reading by reading.</div>
          </div>
          <StatusStrip status={status} />
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-6 py-6 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        <aside>
          {companies === null
            ? <div className="text-[12.5px] text-ink-light px-3">Loading...</div>
            : <CompanyList companies={companies} selectedId={showForm ? null : selectedId} onSelect={select} onAdd={() => setAdding(true)} />}
        </aside>

        <section className="min-w-0">
          {showForm ? (
            <SetupForm
              status={status}
              onCreated={(id) => { setAdding(false); void loadCompanies().then(() => setSelectedId(id)); }}
              onCancel={companies && companies.length ? () => setAdding(false) : undefined}
            />
          ) : selectedId ? (
            <CompanyCard
              key={selectedId}
              companyId={selectedId}
              status={status}
              onChanged={() => void loadCompanies()}
              onDeleted={() => { setSelectedId(null); void loadCompanies(); }}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
