// The receipts: what the assistants actually said.
//
// A rate is a claim; the assistant's own words with the company's name in
// them are proof.

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../api';
import { assistantName } from './Charts';
import { highlight } from './highlight';
import type { AnswerMention } from './types';

interface AnswerRow {
  id: string;
  engine: string;
  repeatIndex: number | null;
  text: string;
  status: string | null;
  mentions: AnswerMention[];
}

interface AnswersResponse {
  prompt: { id: string; text: string; intent: string };
  runId: string | null;
  answers: AnswerRow[];
}

function StanceChip({ context }: { context: string | null }) {
  if (!context) return null;
  const tone =
    context === 'recommended' ? 'text-green bg-green-light' : context === 'dismissed' ? 'text-error bg-error-soft' : 'text-ink-mid bg-bg-alt';
  return <span className={`px-2 py-0.5 rounded-pill text-[10px] font-semibold uppercase tracking-[0.06em] ${tone}`}>{context}</span>;
}

export function AnswerViewer({ companyId, promptId, onClose }: { companyId: string; promptId: string; onClose: () => void }) {
  const [data, setData] = useState<AnswersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api<AnswersResponse>(`/companies/${companyId}/answers?promptId=${encodeURIComponent(promptId)}`)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the answers'); });
    return () => { live = false; };
  }, [companyId, promptId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(0,0,0,0.28)]" onClick={onClose}>
      <div
        className="w-full max-w-[720px] h-full bg-surface border-l border-border overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="What the assistants answered"
      >
        <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-mid">What the assistants answered</div>
            {data && <div className="text-[15px] text-ink mt-1 leading-[1.4]">{data.prompt.text}</div>}
          </div>
          <button onClick={onClose} className="text-ink-light hover:text-ink p-1 shrink-0" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-6">
          {error && <p className="text-[13px] text-error">{error}</p>}
          {!data && !error && <p className="text-[13px] text-ink-light">Loading the answers...</p>}

          {data?.answers.length === 0 && (
            <p className="text-[13px] text-ink-mid">This question has not been asked yet, so there is nothing to show.</p>
          )}

          {data?.answers.map((a) => {
            const mine = a.mentions.filter((m) => m.subject === 'company');
            return (
              <div key={a.id} className="border-b border-border pb-5 last:border-b-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[13px] font-semibold text-ink">{assistantName(a.engine)}</span>
                  {mine.length > 0
                    ? <StanceChip context={mine[0].context} />
                    : <span className="text-[11px] text-ink-light">did not mention you</span>}
                </div>

                {a.status && a.status !== 'ok' ? (
                  <p className="text-[13px] text-ink-mid">This assistant returned an error for this question, so there is no answer to show.</p>
                ) : a.text.trim() === '' ? (
                  <p className="text-[13px] text-ink-mid">This assistant returned an empty answer.</p>
                ) : (
                  <p className="text-[13.5px] leading-[1.6] text-ink whitespace-pre-wrap">{highlight(a.text, a.mentions)}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
