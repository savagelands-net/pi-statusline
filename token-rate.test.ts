/** Unit tests for token-rate tracking and /statusline rate command parsing. */
import { describe, expect, it } from "vitest";

import {
  CHARS_PER_TOKEN,
  createTokenRateTracker,
  formatTokenRate,
  parseTokenRateCommand,
  rateFromTokenRateSnapshot,
  tokenDeltaTextFromEvent,
} from "./token-rate.ts";

describe("parseTokenRateCommand", () => {
  it("maps /statusline rate arguments to actions", () => {
    expect(parseTokenRateCommand([])).toBe("status");
    expect(parseTokenRateCommand(["status"])).toBe("status");
    expect(parseTokenRateCommand(["on"])).toBe("on");
    expect(parseTokenRateCommand(["enable"])).toBe("on");
    expect(parseTokenRateCommand(["off"])).toBe("off");
    expect(parseTokenRateCommand(["disable"])).toBe("off");
    expect(parseTokenRateCommand(["reset"])).toBe("reset");
    expect(parseTokenRateCommand(["wat"])).toBe("invalid");
  });
});

describe("formatTokenRate", () => {
  it("formats missing rates as --", () => {
    expect(formatTokenRate(undefined)).toBe("--");
  });

  it("keeps one decimal below 100 tok/s", () => {
    expect(formatTokenRate(42.25)).toBe("42.3");
  });

  it("drops decimals at 100 tok/s and above", () => {
    expect(formatTokenRate(123.45)).toBe("123");
  });
});

describe("TokenRateTracker", () => {
  it("estimates live tokens from streamed deltas", () => {
    let now = 1_000;
    const tracker = createTokenRateTracker({ now: () => now });

    tracker.start("sonnet");
    now = 2_000;
    tracker.recordDelta("abcdabcd");

    const snapshot = tracker.getSnapshot();
    expect(snapshot?.active).toBe(true);
    expect(snapshot?.model).toBe("sonnet");
    expect(snapshot?.estimatedTokens).toBe(8 / CHARS_PER_TOKEN);
    expect(rateFromTokenRateSnapshot(snapshot!, now)).toBe(2);
  });

  it("prefers provider usage output for the final rate", () => {
    let now = 10_000;
    const tracker = createTokenRateTracker({ now: () => now });

    tracker.start("opus");
    now = 12_000;
    tracker.recordDelta("abcd");
    tracker.finish(20);

    const snapshot = tracker.getSnapshot();
    expect(snapshot?.active).toBe(false);
    expect(snapshot?.finalTokens).toBe(20);
    expect(snapshot?.finalRate).toBe(10);
  });

  it("falls back to estimated tokens when final usage output is missing", () => {
    let now = 100;
    const tracker = createTokenRateTracker({ now: () => now });

    tracker.start("haiku");
    now = 1_100;
    tracker.recordDelta("abcdefgh");
    tracker.finish(undefined);

    const snapshot = tracker.getSnapshot();
    expect(snapshot?.finalTokens).toBe(2);
    expect(snapshot?.finalRate).toBe(2);
  });

  it("finalizes an active stream when the agent ends", () => {
    let now = 5_000;
    const tracker = createTokenRateTracker({ now: () => now });

    tracker.start("sonnet");
    now = 7_000;
    tracker.recordDelta("abcdefgh");
    tracker.stopActive();

    const snapshot = tracker.getSnapshot();
    expect(snapshot?.active).toBe(false);
    expect(snapshot?.finalRate).toBe(1);
  });

  it("reset clears the snapshot", () => {
    const tracker = createTokenRateTracker({ now: () => 0 });
    tracker.start("sonnet");
    tracker.reset();
    expect(tracker.getSnapshot()).toBeNull();
  });
});

describe("tokenDeltaTextFromEvent", () => {
  it("extracts text, thinking, and toolcall deltas", () => {
    expect(tokenDeltaTextFromEvent({ type: "text_delta", delta: "abc" })).toBe("abc");
    expect(tokenDeltaTextFromEvent({ type: "thinking_delta", delta: "def" })).toBe("def");
    expect(tokenDeltaTextFromEvent({ type: "toolcall_delta", delta: "ghi" })).toBe("ghi");
  });

  it("ignores non-delta events", () => {
    expect(tokenDeltaTextFromEvent({ type: "message_stop", delta: "abc" })).toBeNull();
    expect(tokenDeltaTextFromEvent({ type: "text_delta", delta: 42 })).toBeNull();
  });
});
