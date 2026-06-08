/**
 * @wierdbytes/pi-statusline — layout configuration (v2 schema slice).
 *
 * Owns the per-block visibility, ordering, sub-toggle slices, and
 * separator glyph. Lives alongside `display`, `subagents`, and
 * `toastTimeouts` inside `EventsConfig` (see `./events-config.ts`).
 *
 * The renderer walks `order`, calls each block's renderer when its
 * `enabled` flag is on, and joins non-empty results with `separator`.
 * Sub-toggles (`model.showThinking`, `tokens.*`) gate **content
 * inside** a single block — they never change ordering, never
 * introduce a new separator.
 *
 * Normalisation rules (applied on every load, hand-edit, or migration):
 *   - Unknown block ids in `order` are dropped silently.
 *   - Known block ids missing from `order` are appended to the tail
 *     so a future release adding a new block surfaces it on next load.
 *   - Duplicate ids in `order` are de-duplicated (first wins).
 *   - `separator` is clamped to a 1–2 character non-empty string;
 *     anything else falls back to the default `│`.
 *   - `enabled[id]` defaults to `true` for any known id missing from
 *     the persisted record.
 */

import { type BlockId, KNOWN_BLOCK_IDS, KNOWN_BLOCK_ID_SET } from "./blocks.ts";

/** Sub-toggles inside the `model` block. Independent of `enabled.model`. */
export interface ModelSubToggles {
  /** Show the inline thinking-level segment (only relevant for
   *  reasoning-capable models). Default: true. */
  showThinking: boolean;
}

/** Sub-toggles inside the `tokens` block. Each defaults to true. */
export interface TokensSubToggles {
  /** Show `↑input` segment when input usage > 0. */
  input: boolean;
  /** Show `↓output` segment when output usage > 0. */
  output: boolean;
  /** Show `R{cacheRead}` segment when cache-read usage > 0. */
  cacheRead: boolean;
  /** Show `W{cacheWrite}` segment when cache-write usage > 0. */
  cacheWrite: boolean;
}

/** Persisted layout slice. */
export interface LayoutConfig {
  /** Ordered list of block ids. Drives `composeStatusLine`. */
  order: BlockId[];
  /** Per-block visibility. */
  enabled: Record<BlockId, boolean>;
  /** Model sub-toggles (thinking segment). */
  model: ModelSubToggles;
  /** Token-counter sub-toggles. */
  tokens: TokensSubToggles;
  /** Separator glyph rendered between visible blocks. */
  separator: string;
}

/** Default separator glyph (gray box-drawing vertical bar). */
export const DEFAULT_SEPARATOR = "│";

/** Built-in defaults — used by the migration path and `/statusline layout reset`. */
export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = Object.freeze({
  order: [...KNOWN_BLOCK_IDS],
  enabled: Object.freeze({
    model: true,
    path: true,
    git: true,
    context: true,
    cost: true,
    tokens: true,
    rate: true,
    chips: true,
    stash: true,
  }) as Record<BlockId, boolean>,
  model: Object.freeze({ showThinking: true }) as ModelSubToggles,
  tokens: Object.freeze({
    input: true,
    output: true,
    cacheRead: true,
    cacheWrite: true,
  }) as TokensSubToggles,
  separator: DEFAULT_SEPARATOR,
}) as LayoutConfig;

/** Return a deeply-cloned mutable copy of the defaults. */
export function cloneDefaultLayout(): LayoutConfig {
  return {
    order: [...DEFAULT_LAYOUT_CONFIG.order],
    enabled: { ...DEFAULT_LAYOUT_CONFIG.enabled },
    model: { ...DEFAULT_LAYOUT_CONFIG.model },
    tokens: { ...DEFAULT_LAYOUT_CONFIG.tokens },
    separator: DEFAULT_LAYOUT_CONFIG.separator,
  };
}

function normaliseLayoutOrder(rawOrder: unknown, fallback: BlockId[]): BlockId[] {
  if (!Array.isArray(rawOrder)) return fallback;

  const seen = new Set<BlockId>();
  const sanitized: BlockId[] = [];
  for (const candidate of rawOrder) {
    if (typeof candidate !== "string") continue;
    if (!KNOWN_BLOCK_ID_SET.has(candidate as BlockId)) continue;
    const id = candidate as BlockId;
    if (seen.has(id)) continue;
    seen.add(id);
    sanitized.push(id);
  }

  // Append any known ids missing from the persisted order so a new
  // block added in a future release surfaces automatically.
  for (const id of KNOWN_BLOCK_IDS) {
    if (!seen.has(id)) sanitized.push(id);
  }
  return sanitized;
}

function mergeEnabledConfig(
  current: Record<BlockId, boolean>,
  rawEnabled: unknown,
): Record<BlockId, boolean> {
  if (!rawEnabled || typeof rawEnabled !== "object") return current;
  const src = rawEnabled as Record<string, unknown>;
  const next = { ...current };
  for (const id of KNOWN_BLOCK_IDS) {
    if (typeof src[id] === "boolean") next[id] = src[id] as boolean;
  }
  return next;
}

function mergeModelSubToggles(current: ModelSubToggles, rawModel: unknown): ModelSubToggles {
  if (!rawModel || typeof rawModel !== "object") return current;
  const src = rawModel as Record<string, unknown>;
  return typeof src.showThinking === "boolean"
    ? { ...current, showThinking: src.showThinking }
    : current;
}

function mergeTokensSubToggles(current: TokensSubToggles, rawTokens: unknown): TokensSubToggles {
  if (!rawTokens || typeof rawTokens !== "object") return current;
  const src = rawTokens as Record<string, unknown>;
  return {
    ...current,
    ...(typeof src.input === "boolean" ? { input: src.input } : {}),
    ...(typeof src.output === "boolean" ? { output: src.output } : {}),
    ...(typeof src.cacheRead === "boolean" ? { cacheRead: src.cacheRead } : {}),
    ...(typeof src.cacheWrite === "boolean" ? { cacheWrite: src.cacheWrite } : {}),
  };
}

/**
 * Normalise a (potentially partial / malformed) layout slice against
 * the defaults. Returns a fully-populated `LayoutConfig`:
 *
 *   - `order` is de-duplicated, unknown ids dropped, missing known ids
 *     appended to the tail in `KNOWN_BLOCK_IDS` order.
 *   - `enabled` keys missing for known ids default to `true`; extra
 *     keys are dropped.
 *   - `model` / `tokens` sub-toggles default to `true` per key.
 *   - `separator` is validated/clamped.
 */
export function normaliseLayoutConfig(raw: Partial<LayoutConfig> | undefined): LayoutConfig {
  const merged = cloneDefaultLayout();
  if (!raw || typeof raw !== "object") return merged;

  return {
    ...merged,
    order: normaliseLayoutOrder(raw.order, merged.order),
    enabled: mergeEnabledConfig(merged.enabled, raw.enabled),
    model: mergeModelSubToggles(merged.model, raw.model),
    tokens: mergeTokensSubToggles(merged.tokens, raw.tokens),
    separator: clampSeparator(raw.separator),
  };
}

/**
 * Clamp the separator glyph to a non-empty 1–2 char string.
 * Falls back to `DEFAULT_SEPARATOR` for anything else (empty string,
 * non-string, oversized payload).
 */
export function clampSeparator(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SEPARATOR;
  // Strip newlines/tabs defensively — a separator with a newline
  // would corrupt the single-row layout.
  const cleaned = value.replace(/[\r\n\t]/g, "");
  if (cleaned.length === 0) return DEFAULT_SEPARATOR;
  // We only display ~1 char on most terminals; allow up to 2 so users
  // can pass things like `" "` (a wider visual gap) or `"::"`.
  return cleaned.length > 2 ? cleaned.slice(0, 2) : cleaned;
}

/** Built-in separator option labels for the settings modal. */
export const SEPARATOR_OPTIONS = ["│", "·", "▎", ":", " "] as const;
export type SeparatorOption = (typeof SEPARATOR_OPTIONS)[number];
export const SEPARATOR_LABELS: Record<SeparatorOption, string> = {
  "│": "│ — vertical bar (default)",
  "·": "· — middle dot",
  "▎": "▎ — heavy left bar",
  ":": ": — colon",
  " ": "(space) — no glyph",
};
