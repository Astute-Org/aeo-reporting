// The half that talks to the network. Rendering lives in CompanyView.tsx.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from '../ui/Toast';
import { SkeletonCard } from '../ui/Shimmer';
import { AnswerViewer } from './AnswerViewer';
import { CompanyReportView, estimateReadingUsd } from './CompanyView';
import type { CompanyInfo, CompanyPanel, CompanyPrompt, CompanyReport, PromptWithStats, Status } from './types';

const POLL_MS = 15_000;

export function CompanyCard({
  companyId, status, onChanged, onDeleted,
}: {
  companyId: string;
  status: Status | null;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { showToast } = useToast();
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [panel, setPanel] = useState<CompanyPanel | null>(null);
  const [prompts, setPrompts] = useState<PromptWithStats[]>([]);
  const [report, setReport] = useState<CompanyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const [r, p] = await Promise.all([
        api<CompanyReport>(`/companies/${companyId}/report`),
        api<{ prompts: PromptWithStats[] }>(`/companies/${companyId}/prompts`),
      ]);
      setReport(r);
      setPrompts(p.prompts ?? []);
    } catch {
      setReport(null);
    } finally {
      setReportLoading(false);
    }
  }, [companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ company: CompanyInfo; panel: CompanyPanel | null; prompts: CompanyPrompt[] }>(`/companies/${companyId}`);
      setCompany(res.company);
      setPanel(res.panel);
      setPrompts((res.prompts ?? []).map((p) => ({ answers: 0, mentioned: 0, cited: 0, ...p })));
      void loadReport();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not load this company', 'error');
      setCompany(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, loadReport, showToast]);

  useEffect(() => { void load(); }, [load]);

  // While a reading is in flight, poll so the progress banner moves and the
  // numbers land without a refresh. When it finishes, the list in the sidebar
  // (reading count, running dot) is stale too, so tell the parent.
  const wasRunning = useRef(false);
  useEffect(() => {
    const running = Boolean(report?.inProgress);
    if (wasRunning.current && !running) onChanged();
    wasRunning.current = running;
    if (!running) return;
    const t = setInterval(() => void loadReport(), POLL_MS);
    return () => clearInterval(t);
  }, [report?.inProgress, loadReport, onChanged]);

  const run = async () => {
    if (!company) return;
    const estimate = estimateReadingUsd(status, prompts.length, panel?.repeats ?? 1);
    const ok = window.confirm(
      `Take a reading now? This asks ${prompts.length} questions on ${status?.engines.length ?? 0} assistant(s)` +
        (estimate !== null ? `, roughly $${estimate.toFixed(2)} in API calls.` : '.'),
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api<{ engines: string[]; answersExpected: number }>(`/companies/${company.id}/runs`, { method: 'POST' });
      showToast(`Reading started: ${res.answersExpected} answers on ${res.engines.join(', ')}. A few minutes.`, 'success');
      await loadReport();
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start a reading', 'error');
    } finally {
      setBusy(false);
    }
  };

  const patch = async (body: Record<string, unknown>, fallback: string) => {
    setBusy(true);
    try {
      const res = await api<{ notes: string[] }>(`/companies/${companyId}`, { method: 'PATCH', body: JSON.stringify(body) });
      showToast(res.notes[0] ?? fallback, 'success');
      await load();
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setBusy(false);
    }
  };

  const savePanel = async (rows: { text: string; intent: string }[]) => {
    setBusy(true);
    try {
      const res = await api<{ version: number; warnings: string[]; note: string }>(`/companies/${companyId}/panel`, {
        method: 'PUT',
        body: JSON.stringify({ prompts: rows }),
      });
      showToast(res.warnings.length ? `${res.note} ${res.warnings[0]}` : res.note, res.warnings.length ? 'error' : 'success');
      await load();
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the questions', 'error');
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (!window.confirm('Ask the model for a fresh set of questions from the website? The current questions stay attached to past readings; this creates a new version.')) return;
    setBusy(true);
    try {
      const res = await api<{ note: string; balanced: boolean }>(`/companies/${companyId}/panel/generate`, { method: 'POST' });
      showToast(res.balanced ? res.note : `${res.note} They are not evenly spread across the four kinds - worth a look.`, res.balanced ? 'success' : 'error');
      await load();
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not generate questions', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!company) return;
    if (!window.confirm(`Delete ${company.name} and every reading it has ever taken? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api(`/companies/${company.id}`, { method: 'DELETE' });
      showToast(`${company.name} deleted`, 'info');
      onDeleted();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete', 'error');
      setBusy(false);
    }
  };

  if (loading && !company) return <SkeletonCard />;
  if (!company) return null;

  return (
    <>
      <CompanyReportView
        company={company}
        panel={panel}
        prompts={prompts}
        report={report}
        reportLoading={reportLoading}
        status={status}
        onRun={() => void run()}
        onSaveCompetitors={(competitors) => void patch({ competitors }, 'Competitors updated')}
        onSaveAliases={(aliases) => void patch({ aliases }, 'Aliases updated')}
        onSavePanel={(rows) => void savePanel(rows)}
        onRegenerate={() => void regenerate()}
        onDelete={() => void remove()}
        onSelectPrompt={setSelectedPrompt}
        busy={busy}
      />
      {selectedPrompt && (
        <AnswerViewer companyId={company.id} promptId={selectedPrompt} onClose={() => setSelectedPrompt(null)} />
      )}
    </>
  );
}
