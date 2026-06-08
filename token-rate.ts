export const CHARS_PER_TOKEN = 4;

const DELTA_EVENT_TYPES = new Set(["text_delta", "thinking_delta", "toolcall_delta"]);

export interface TokenRateSnapshot {
  active: boolean;
  model: string;
  startedAt: number;
  lastAt: number;
  estimatedTokens: number;
  finalTokens?: number;
  finalRate?: number;
}

export interface TokenRateTracker {
  getSnapshot(): TokenRateSnapshot | null;
  start(model: string): void;
  recordDelta(delta: string): boolean;
  finish(outputTokens: number | undefined): boolean;
  stopActive(): boolean;
  reset(): void;
}

export interface CreateTokenRateTrackerOptions {
  now?: () => number;
  charsPerToken?: number;
}

export type TokenRateCommandAction = "status" | "on" | "off" | "reset" | "invalid";

export function parseTokenRateCommand(tokens: readonly string[]): TokenRateCommandAction {
  const subcommand = tokens[0]?.toLowerCase();
  if (!subcommand || subcommand === "status") return "status";
  if (subcommand === "on" || subcommand === "enable") return "on";
  if (subcommand === "off" || subcommand === "disable") return "off";
  if (subcommand === "reset") return "reset";
  return "invalid";
}

export function formatTokenRate(rate: number | undefined): string {
  if (!Number.isFinite(rate ?? NaN)) return "--";
  const value = rate ?? 0;
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

export function rateFromTokenRateSnapshot(
  snapshot: TokenRateSnapshot,
  now = Date.now(),
): number | undefined {
  const elapsedSeconds = Math.max(0.001, (now - snapshot.startedAt) / 1000);
  const tokens = snapshot.finalTokens ?? snapshot.estimatedTokens;
  return tokens / elapsedSeconds;
}

export function tokenDeltaTextFromEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const candidate = event as { type?: unknown; delta?: unknown };
  if (typeof candidate.type !== "string" || !DELTA_EVENT_TYPES.has(candidate.type)) {
    return null;
  }
  return typeof candidate.delta === "string" ? candidate.delta : null;
}

export function createTokenRateTracker(
  options: CreateTokenRateTrackerOptions = {},
): TokenRateTracker {
  const now = options.now ?? (() => Date.now());
  const charsPerToken =
    typeof options.charsPerToken === "number" && options.charsPerToken > 0
      ? options.charsPerToken
      : CHARS_PER_TOKEN;
  let snapshot: TokenRateSnapshot | null = null;

  const finishWithTokens = (tokens: number, finishedAt: number): boolean => {
    if (!snapshot?.active) return false;
    snapshot = {
      ...snapshot,
      active: false,
      lastAt: finishedAt,
      finalTokens: tokens,
      finalRate: tokens / Math.max(0.001, (finishedAt - snapshot.startedAt) / 1000),
    };
    return true;
  };

  return {
    getSnapshot: () => (snapshot ? { ...snapshot } : null),

    start(model: string): void {
      const startedAt = now();
      snapshot = {
        active: true,
        model,
        startedAt,
        lastAt: startedAt,
        estimatedTokens: 0,
      };
    },

    recordDelta(delta: string): boolean {
      if (!snapshot?.active) return false;
      const at = now();
      snapshot = {
        ...snapshot,
        lastAt: at,
        estimatedTokens: snapshot.estimatedTokens + Math.max(0, delta.length / charsPerToken),
      };
      return true;
    },

    finish(outputTokens: number | undefined): boolean {
      if (!snapshot?.active) return false;
      const tokens =
        typeof outputTokens === "number" && Number.isFinite(outputTokens) && outputTokens > 0
          ? outputTokens
          : snapshot.estimatedTokens;
      return finishWithTokens(tokens, now());
    },

    stopActive(): boolean {
      if (!snapshot?.active) return false;
      return finishWithTokens(snapshot.finalTokens ?? snapshot.estimatedTokens, now());
    },

    reset(): void {
      snapshot = null;
    },
  };
}
