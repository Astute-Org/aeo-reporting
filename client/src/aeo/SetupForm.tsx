// Start tracking a company.
//
// States the cost before the click rather than after it: this form starts a
// recurring third-party bill, and a setup screen that hides that is how a
// tool ends up spending money nobody chose.

import { useState } from 'react';
import { Building2, Plus } from 'lucide-react';
import { api } from '../api';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { TextInput, Textarea } from '../ui/Input';
import { useToast } from '../ui/Toast';
import { parseList } from './CompanyView';
import { assistantName } from './Charts';
import type { Status } from './types';

export function SetupForm({ status, onCreated, onCancel }: { status: Status | null; onCreated: (id: string) => void; onCancel?: () => void }) {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [aliases, setAliases] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const engines = status?.engines ?? [];
  const cadenceDays = Math.round((status?.cadenceHoursDefault ?? 240) / 24);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await api<{ id: string; promptCount: number; panelWarning: string | null; note: string }>('/companies', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), url: url.trim() || null, aliases: parseList(aliases), competitors: parseList(competitors), notes: notes.trim() || null }),
      });
      showToast(res.panelWarning ?? `${res.promptCount} questions written. ${res.note}`, res.panelWarning ? 'error' : 'success');
      onCreated(res.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start tracking', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <Building2 size={16} className="text-ink-light mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-[15px] font-medium text-ink">Track a company</div>
            <div className="text-[12.5px] text-ink-mid mt-1 leading-[1.5]">
              How does this company show up when a buyer asks an AI assistant about its market? A set of buyer questions is
              written from the website, asked of every assistant every {cadenceDays} days, and scored: named or not, cited
              or not, recommended or dismissed, against the competitors you declare.
            </div>
            <div className="text-[12px] text-ink-light mt-2">
              {engines.length
                ? `Assistants configured: ${engines.map(assistantName).join(', ')}. About 20 questions a reading; each reading is a few dollars of API calls.`
                : 'No assistant is configured yet - set at least one API key on the server before the first reading.'}
              {status?.judge ? '' : ' No judge model is configured, so questions cannot be generated automatically; you can still write them by hand.'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextInput label="Company name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Calo" required helpText="The exact name the scorer looks for in answers." />
          <TextInput label="Website" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="calo.app" helpText="Questions are written from it, and citations of it are counted." />
          <TextInput label="Also known as" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Comma-separated other names" helpText="Old names, short names, spellings an assistant might use." />
          <TextInput label="Competitors" value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="Comma-separated competitor names" helpText="The share-of-voice denominator. Miss one and it is silently absent." />
        </div>
        <Textarea
          label="Notes for question writing (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Buyers are in Saudi Arabia and the UAE. Questions in English. The product is a meal subscription, not a restaurant."
          helpText="Anything the website does not make obvious about who buys and where. Also used as the material when the website cannot be read."
        />

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy || !name.trim()}>
            <Plus size={14} /> {busy ? 'Writing the questions...' : 'Start tracking'}
          </Button>
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        </div>
      </form>
    </Card>
  );
}
