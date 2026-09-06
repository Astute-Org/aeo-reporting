// Mirrors of the server's response shapes. Kept in one file so a renamed
// field breaks the typecheck in one place rather than three.

export interface RateValue {
  value: number | null;
  hits: number;
  n: number;
  ci95?: [number, number] | null;
}

export interface Metrics {
  answers: number;
  prompts: number;
  citationRate: RateValue;
  mentionRate: RateValue;
  retrievalRate: RateValue;
  selectionRate: RateValue;
  promptCoverage: RateValue;
  shareOfVoice: RateValue;
  meanPosition: number | null;
  byIntent: Record<string, RateValue>;
  byEngine: Record<string, RateValue>;
}

export interface StandingEntry {
  name: string;
  isCompany: boolean;
  questions: number;
  mentions: number;
  recommended: number;
  compared: number;
  dismissed: number;
  passing: number;
}

export interface Standing {
  runId: string;
  totalQuestions: number;
  entries: StandingEntry[];
  companyRank: number | null;
  companyName: string;
}

export interface StandingTrendPoint {
  runId: string;
  startedAt: string;
  panelVersion: number;
  companyRank: number | null;
  entrants: number;
  questionsMentioned: number;
  totalQuestions: number;
}

export interface InProgress {
  runId: string;
  startedAt: string;
  answersExpected: number | null;
  answersSoFar: number;
}

export interface CompanyInfo {
  id: string;
  name: string;
  domain: string | null;
  url: string | null;
  aliases: string[];
  competitors: string[];
  notes: string | null;
  createdAt: string;
}

export interface CompanyPanel {
  id: string;
  version: number;
  category: string | null;
  repeats: number;
  cadenceHours: number;
  lastRunAt: string | null;
}

export interface CompanyPrompt {
  id: string;
  text: string;
  intent: string;
  position: number | null;
}

export interface PromptWithStats extends CompanyPrompt {
  answers: number;
  mentioned: number;
  cited: number;
}

export interface CompanyReport {
  companyId: string;
  name: string;
  competitors: string[];
  aliases: string[];
  latest: { runId: string; startedAt: string; completedAt: string | null; metrics: Metrics } | null;
  standing: Standing | null;
  trend: StandingTrendPoint[];
  runsMeasured: number;
  inProgress: InProgress | null;
  caveats: string[];
}

export interface CompanySummary {
  id: string;
  name: string;
  domain: string | null;
  createdAt: string;
  panelVersion: number | null;
  promptCount: number;
  runsMeasured: number;
  lastReadingAt: string | null;
  running: boolean;
}

export interface Status {
  engines: string[];
  engineError: string | null;
  judge: { provider: string; model: string; panelModel: string } | null;
  llmScoring: boolean;
  scheduler: { enabled: boolean; intervalMinutes: number };
  cadenceHoursDefault: number;
  costPerAnswerUsd: Record<string, number>;
}

export interface AnswerMention {
  subject: 'company' | 'competitor';
  label: string | null;
  context: string | null;
  position: number | null;
}
