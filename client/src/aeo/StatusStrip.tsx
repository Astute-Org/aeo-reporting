// Is measurement switched on, and who is answering?
//
// Engines drop out silently when a key is missing, so a screen with no
// numbers is ambiguous unless it says why.

import { AlertTriangle, CheckCircle2, Radio } from 'lucide-react';
import { assistantName } from './Charts';
import type { Status } from './types';

export function StatusStrip({ status }: { status: Status | null }) {
  if (!status) return null;
  const ok = status.engines.length > 0;

  return (
    <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[12px] text-ink-mid">
      <span className="inline-flex items-center gap-1.5">
        {ok ? <CheckCircle2 size={13} className="text-green" /> : <AlertTriangle size={13} className="text-warn" />}
        {ok ? `Measuring ${status.engines.map(assistantName).join(', ')}` : 'No assistant configured'}
      </span>
      {status.engineError && <span className="text-error">{status.engineError}</span>}
      <span className="inline-flex items-center gap-1.5">
        {status.judge ? <CheckCircle2 size={13} className="text-green" /> : <AlertTriangle size={13} className="text-warn" />}
        {status.judge ? `Judge: ${status.judge.model}` : 'No judge model'}
        {status.judge && !status.llmScoring && ' (scoring pass off)'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Radio size={13} className={status.scheduler.enabled ? 'text-green' : 'text-ink-light'} />
        {status.scheduler.enabled ? `Scheduler on, every ${status.scheduler.intervalMinutes} min` : 'Scheduler off'}
      </span>
    </div>
  );
}
