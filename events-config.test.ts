import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { loadEventsConfig, saveEventsConfig } from "./events-config.ts";

const originalHome = process.env.HOME;

const CONFIG_DIR_NAME = "savagelands-net-pi-statusline";
const LEGACY_CONFIG_DIR_NAME = "wierd-statusline";

afterEach(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
});

function useTempHome(): string {
	const home = mkdtempSync(join(tmpdir(), "pi-statusline-home-"));
	process.env.HOME = home;
	return home;
}

function writeConfig(home: string, dirName: string, data: unknown): void {
	const configDir = join(home, ".pi", "agent", dirName);
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "events.json"), JSON.stringify(data));
}

function configPath(home: string, dirName: string): string {
	return join(home, ".pi", "agent", dirName, "events.json");
}

describe("events config display placement", () => {
	it("defaults to below-editor statusline placement", () => {
		useTempHome();

		expect(loadEventsConfig().display.statusWidgetPlacement).toBe(
			"belowEditor",
		);
	});

	it("loads an above-editor statusline placement from the savagelands config dir", () => {
		const home = useTempHome();
		writeConfig(home, CONFIG_DIR_NAME, {
			display: { statusWidgetPlacement: "aboveEditor" },
		});

		expect(loadEventsConfig().display.statusWidgetPlacement).toBe(
			"aboveEditor",
		);
	});

	it("prefers the savagelands config when a legacy wierd config also exists", () => {
		const home = useTempHome();
		writeConfig(home, LEGACY_CONFIG_DIR_NAME, {
			display: { statusWidgetPlacement: "aboveEditor" },
		});
		writeConfig(home, CONFIG_DIR_NAME, {
			display: { statusWidgetPlacement: "belowEditor" },
		});

		expect(loadEventsConfig().display.statusWidgetPlacement).toBe(
			"belowEditor",
		);
	});

	it("migrates a legacy wierd config into the savagelands config dir", () => {
		const home = useTempHome();
		writeConfig(home, LEGACY_CONFIG_DIR_NAME, {
			display: { statusWidgetPlacement: "aboveEditor" },
		});

		expect(loadEventsConfig().display.statusWidgetPlacement).toBe(
			"aboveEditor",
		);

		const migrated = JSON.parse(
			readFileSync(configPath(home, CONFIG_DIR_NAME), "utf-8"),
		);
		expect(migrated.display.statusWidgetPlacement).toBe("aboveEditor");
	});

	it("saves config to the savagelands config dir without creating legacy wierd config", () => {
		const home = useTempHome();

		saveEventsConfig(loadEventsConfig());

		expect(existsSync(configPath(home, CONFIG_DIR_NAME))).toBe(true);
		expect(existsSync(configPath(home, LEGACY_CONFIG_DIR_NAME))).toBe(false);
	});

	it("rejects invalid persisted statusline placement values", () => {
		const home = useTempHome();
		writeConfig(home, CONFIG_DIR_NAME, {
			display: { statusWidgetPlacement: "sideways" },
		});

		expect(loadEventsConfig().display.statusWidgetPlacement).toBe(
			"belowEditor",
		);
	});
});
