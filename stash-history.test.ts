import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	persistStashHistory,
	readPersistedStashHistory,
} from "./stash-history.ts";

const originalHome = process.env.HOME;

const CONFIG_DIR_NAME = "savagelands-net-pi-statusline";
const LEGACY_CONFIG_DIR_NAME = "wierd-statusline";

afterEach(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
});

function useTempHome(): string {
	const home = mkdtempSync(join(tmpdir(), "pi-statusline-stash-home-"));
	process.env.HOME = home;
	return home;
}

function stashPath(home: string, dirName: string): string {
	return join(home, ".pi", "agent", dirName, "stash-history.json");
}

function writeStashHistory(
	home: string,
	dirName: string,
	history: string[],
): void {
	const path = stashPath(home, dirName);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, JSON.stringify({ version: 1, history }));
}

describe("stash history storage paths", () => {
	it("reads stash history from the savagelands config dir", () => {
		const home = useTempHome();
		writeStashHistory(home, CONFIG_DIR_NAME, ["new prompt"]);

		expect(readPersistedStashHistory()).toEqual(["new prompt"]);
	});

	it("prefers savagelands stash history when legacy wierd history also exists", () => {
		const home = useTempHome();
		writeStashHistory(home, LEGACY_CONFIG_DIR_NAME, ["legacy prompt"]);
		writeStashHistory(home, CONFIG_DIR_NAME, ["new prompt"]);

		expect(readPersistedStashHistory()).toEqual(["new prompt"]);
	});

	it("migrates legacy wierd stash history into the savagelands config dir", () => {
		const home = useTempHome();
		writeStashHistory(home, LEGACY_CONFIG_DIR_NAME, ["legacy prompt"]);

		expect(readPersistedStashHistory()).toEqual(["legacy prompt"]);

		const migrated = JSON.parse(
			readFileSync(stashPath(home, CONFIG_DIR_NAME), "utf-8"),
		);
		expect(migrated.history).toEqual(["legacy prompt"]);
	});

	it("persists stash history to savagelands without creating legacy wierd history", () => {
		const home = useTempHome();

		persistStashHistory(["saved prompt"]);

		expect(existsSync(stashPath(home, CONFIG_DIR_NAME))).toBe(true);
		expect(existsSync(stashPath(home, LEGACY_CONFIG_DIR_NAME))).toBe(false);
	});
});
