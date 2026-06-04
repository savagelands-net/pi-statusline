import { describe, expect, it } from "vitest";

import {
  renderEditorLinesForStatusline,
  STATUS_WIDGET_PLACEMENT,
} from "./index.ts";

describe("statusline placement", () => {
  it("renders the status widget below the editor", () => {
    expect(STATUS_WIDGET_PLACEMENT).toBe("belowEditor");
  });

  it("keeps the editor bottom border as a divider above the statusline", () => {
    const lines = ["────", "prompt text", "────"];

    expect(renderEditorLinesForStatusline(lines)).toEqual(lines);
  });
});
