import { describe, expect, it } from "vitest";

import {
  DEFAULT_STATUS_WIDGET_PLACEMENT,
  PROMPT_PREFIX,
  renderEditorLinesForStatusline,
} from "./index.ts";

describe("statusline placement", () => {
  it("defaults to rendering the status widget below the editor", () => {
    expect(DEFAULT_STATUS_WIDGET_PLACEMENT).toBe("belowEditor");
  });

  it("adds a prompt prefix while keeping the bottom divider in below-editor placement", () => {
    const lines = ["────", "prompt text", "────"];

    expect(renderEditorLinesForStatusline(lines, "belowEditor")).toEqual([
      "────",
      `${PROMPT_PREFIX} prompt text`,
      "────",
    ]);
  });

  it("adds a prompt prefix while keeping the bottom divider in above-editor placement", () => {
    const lines = ["────", "prompt text", "────"];

    expect(renderEditorLinesForStatusline(lines, "aboveEditor")).toEqual([
      `${PROMPT_PREFIX} prompt text`,
      "────",
    ]);
  });

  it("indents continuation lines under the prompt prefix", () => {
    const lines = ["────", "first line", "second line", "────"];

    expect(renderEditorLinesForStatusline(lines, "belowEditor")).toEqual([
      "────",
      `${PROMPT_PREFIX} first line`,
      "  second line",
      "────",
    ]);
  });
});
