// Progress stages streamed to the app while the assistant works. Every stage is started and finished around a real
// awaited operation (a model call or a tool execution), never on a timer, so the checklist the customer sees is true.
// The app shows localized labels keyed by `key`; `label` here is the English fallback.

export type StageKey = "understanding" | "backup" | "services" | "history" | "pros" | "pricing" | "drafting" | "reviewing";

export const STAGE_LABELS: Record<StageKey, string> = {
  understanding: "Understanding your request",
  backup: "Switching to a backup AI model",
  services: "Checking available services",
  history: "Checking your past bookings",
  pros: "Finding top-rated pros near you",
  pricing: "Estimating price from recent jobs",
  drafting: "Preparing your booking draft",
  reviewing: "Reviewing what I found",
};

/** Which stage a tool call represents. Tools not listed (e.g. respond) show no stage. */
export const TOOL_STAGE: Record<string, StageKey> = {
  list_categories: "services",
  get_my_history: "history",
  search_providers: "pros",
  get_price_estimate: "pricing",
  draft_booking: "drafting",
};

export type StageStatus = "active" | "done" | "failed";

export interface StageEvent {
  type: "stage";
  key: StageKey;
  label: string;
  status: StageStatus;
  /** ms since the request started */
  t: number;
  /** duration of this run of the stage (done/failed only) */
  ms?: number;
}

export interface StageSummary {
  key: StageKey;
  ms: number;
  ok: boolean;
}

export class StageTracker {
  private readonly open = new Map<StageKey, number>();
  private readonly finished: StageSummary[] = [];

  constructor(
    private readonly emit: (e: StageEvent) => void,
    private readonly startedAt: number,
    private readonly now: () => number = Date.now,
  ) {}

  start(key: StageKey): void {
    if (this.open.has(key)) return;
    const t = this.now();
    this.open.set(key, t);
    this.emit({ type: "stage", key, label: STAGE_LABELS[key], status: "active", t: t - this.startedAt });
  }

  finish(key: StageKey, ok = true): void {
    const began = this.open.get(key);
    if (began == null) return; // finishing a stage that never started would be a fake step
    this.open.delete(key);
    const t = this.now();
    const ms = t - began;
    this.finished.push({ key, ms, ok });
    this.emit({ type: "stage", key, label: STAGE_LABELS[key], status: ok ? "done" : "failed", t: t - this.startedAt, ms });
  }

  /** Runs `work` as stage `key`: active before, done/failed after. */
  async run<T>(key: StageKey, work: () => Promise<T>, ok: (v: T) => boolean = () => true): Promise<T> {
    this.start(key);
    try {
      const v = await work();
      this.finish(key, ok(v));
      return v;
    } catch (e) {
      this.finish(key, false);
      throw e;
    }
  }

  /** Completed stage runs in order (for the final event, logs and stage-latency analytics). */
  summary(): StageSummary[] {
    return [...this.finished];
  }
}
