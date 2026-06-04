import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { loadEventsConfig } from "./events-config.ts";

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

function useTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "pi-statusline-home-"));
  process.env.HOME = home;
  return home;
}

describe("events config display placement", () => {
  it("defaults to below-editor statusline placement", () => {
    useTempHome();

    expect(loadEventsConfig().display.statusWidgetPlacement).toBe("belowEditor");
  });

  it("loads an above-editor statusline placement from persisted config", () => {
    const home = useTempHome();
    const configDir = join(home, ".pi", "agent", "wierd-statusline");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "events.json"),
      JSON.stringify({ display: { statusWidgetPlacement: "aboveEditor" } }),
    );

    expect(loadEventsConfig().display.statusWidgetPlacement).toBe("aboveEditor");
  });

  it("rejects invalid persisted statusline placement values", () => {
    const home = useTempHome();
    const configDir = join(home, ".pi", "agent", "wierd-statusline");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "events.json"),
      JSON.stringify({ display: { statusWidgetPlacement: "sideways" } }),
    );

    expect(loadEventsConfig().display.statusWidgetPlacement).toBe("belowEditor");
  });
});
