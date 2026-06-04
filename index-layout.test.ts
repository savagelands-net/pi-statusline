import { describe, expect, it } from "vitest";

import {
  DEFAULT_STATUS_WIDGET_PLACEMENT,
  renderEditorLinesForStatusline,
} from "./index.ts";

describe("statusline placement", () => {
  it("defaults to rendering the status widget below the editor", () => {
    expect(DEFAULT_STATUS_WIDGET_PLACEMENT).toBe("belowEditor");
  });

  it("keeps the editor bottom border as a divider above the below-editor statusline", () => {
    const lines = ["────", "prompt text", "────"];

    expect(renderEditorLinesForStatusline(lines, "belowEditor")).toEqual(lines);
  });

  it("keeps the editor bottom border as a divider when the statusline is above the editor", () => {
    const lines = ["────", "prompt text", "────"];

    expect(renderEditorLinesForStatusline(lines, "aboveEditor")).toEqual(["prompt text", "────"]);
  });
});
