import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	SelectList,
	truncateToWidth,
	type Component,
	type SelectItem,
	type TUI,
} from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
	getLegacyStatuslineDataPath,
	getStatuslineDataPath,
} from "./storage-paths.ts";

const STASH_HISTORY_LIMIT = 12;
const STASH_PREVIEW_WIDTH = 72;

export function hasNonWhitespaceText(text: string): boolean {
	return text.trim().length > 0;
}

function getStashHistoryPath(): string {
	return getStatuslineDataPath("stash-history.json");
}

function getLegacyStashHistoryPath(): string {
	return getLegacyStatuslineDataPath("stash-history.json");
}

function normalizeStashHistoryEntries(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const history: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") continue;
		if (!hasNonWhitespaceText(entry)) continue;
		if (history[history.length - 1] === entry) continue;
		history.push(entry);
		if (history.length >= STASH_HISTORY_LIMIT) break;
	}
	return history;
}

export function readPersistedStashHistory(): string[] {
	const current = readStashHistoryFile(getStashHistoryPath());
	if (current !== null) return current;

	const legacy = readStashHistoryFile(getLegacyStashHistoryPath());
	if (legacy !== null) {
		persistStashHistory(legacy);
		return legacy;
	}

	return [];
}

function readStashHistoryFile(path: string): string[] | null {
	try {
		if (!existsSync(path)) return null;
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return [];
		return normalizeStashHistoryEntries(
			(parsed as { history?: unknown }).history,
		);
	} catch {
		return [];
	}
}

export function persistStashHistory(history: string[]): void {
	const path = getStashHistoryPath();
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			path,
			JSON.stringify(
				{ version: 1, history: history.slice(0, STASH_HISTORY_LIMIT) },
				null,
				2,
			) + "\n",
		);
	} catch {
		// Stash history persistence is best-effort.
	}
}

export function pushStashHistoryEntry(
	history: string[],
	text: string,
): boolean {
	if (!hasNonWhitespaceText(text)) return false;
	if (history[0] === text) return false;
	const existingIndex = history.indexOf(text);
	if (existingIndex >= 0) history.splice(existingIndex, 1);
	history.unshift(text);
	if (history.length > STASH_HISTORY_LIMIT)
		history.length = STASH_HISTORY_LIMIT;
	return true;
}

function buildStashPreview(text: string, maxWidth: number): string {
	const compact = text.replace(/\s+/g, " ").trim();
	if (!compact) return "(empty)";
	return truncateToWidth(compact, maxWidth, "…");
}

function overlaySelectListTheme(theme: Theme) {
	return {
		selectedPrefix: (text: string) => theme.fg("accent", text),
		selectedText: (text: string) => theme.fg("accent", text),
		description: (text: string) => theme.fg("muted", text),
		scrollInfo: (text: string) => theme.fg("dim", text),
		noMatch: (text: string) => theme.fg("warning", text),
	};
}

function buildItems(entries: string[]): SelectItem[] {
	return entries.map((entry, index) => ({
		value: String(index),
		label: `#${index + 1} ${buildStashPreview(entry, STASH_PREVIEW_WIDTH)}`,
	}));
}

function createSelectList(
	entries: string[],
	theme: Theme,
	done: (item: SelectItem | null) => void,
): SelectList {
	const maxVisible = Math.min(Math.max(entries.length, 1), 10);
	const selectList = new SelectList(
		buildItems(entries),
		maxVisible,
		overlaySelectListTheme(theme),
	);
	selectList.onSelect = (item) => done(item);
	selectList.onCancel = () => done(null);
	return selectList;
}

interface StashHistoryOverlayArgs {
	entries: string[];
	theme: Theme;
	tui: TUI;
	done: (item: SelectItem | null) => void;
	onDelete: (text: string) => void;
}

class StashHistoryOverlayComponent implements Component {
	private selectList: SelectList;

	constructor(private readonly args: StashHistoryOverlayArgs) {
		this.selectList = createSelectList(args.entries, args.theme, args.done);
	}

	private border(text: string): string {
		return this.args.theme.fg("dim", text);
	}

	private wrapRow(text: string, innerWidth: number): string {
		return `${this.border("│")}${truncateToWidth(text, innerWidth, "…", true)}${this.border("│")}`;
	}

	private rebuild(focusIndex: number): void {
		if (this.args.entries.length === 0) {
			this.args.done(null);
			return;
		}
		this.selectList = createSelectList(
			this.args.entries,
			this.args.theme,
			this.args.done,
		);
		this.selectList.setSelectedIndex(
			Math.max(0, Math.min(focusIndex, this.args.entries.length - 1)),
		);
		this.args.tui.requestRender();
	}

	private deleteSelected(): void {
		const item = this.selectList.getSelectedItem();
		if (!item) return;
		const idx = Number.parseInt(item.value, 10);
		const text = this.args.entries[idx];
		if (text === undefined) return;
		this.args.entries.splice(idx, 1);
		this.args.onDelete(text);
		this.rebuild(idx);
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const lines: string[] = [];
		lines.push(this.border(`╭${"─".repeat(innerWidth)}╮`));
		lines.push(
			this.wrapRow(
				this.args.theme.fg("accent", this.args.theme.bold("Stash history")),
				innerWidth,
			),
		);
		lines.push(this.border(`├${"─".repeat(innerWidth)}┤`));
		for (const line of this.selectList.render(innerWidth))
			lines.push(this.wrapRow(line, innerWidth));
		lines.push(this.border(`├${"─".repeat(innerWidth)}┤`));
		lines.push(
			this.wrapRow(
				this.args.theme.fg(
					"dim",
					"↑↓ navigate • enter insert • d delete • esc cancel",
				),
				innerWidth,
			),
		);
		lines.push(this.border(`╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	invalidate(): void {
		this.selectList.invalidate();
	}

	handleInput(data: string): void {
		if (data === "d" || data === "D") {
			this.deleteSelected();
			return;
		}
		this.selectList.handleInput(data);
		this.args.tui.requestRender();
	}
}

function createStashHistoryOverlay(args: StashHistoryOverlayArgs): Component {
	return new StashHistoryOverlayComponent(args);
}

export async function showStashHistoryOverlay(
	ctx: ExtensionContext,
	history: string[],
	onDelete: (text: string) => void,
): Promise<string | null> {
	const entries = [...history];
	const selected = await ctx.ui.custom<SelectItem | null>(
		(tui, theme, _keybindings, done) =>
			createStashHistoryOverlay({ entries, theme, tui, done, onDelete }),
		{
			overlay: true,
			overlayOptions: () => ({ anchor: "center" }),
		},
	);

	if (!selected) return null;
	const i = Number.parseInt(selected.value, 10);
	return entries[i] ?? null;
}

export async function insertStashHistoryEntry(
	ctx: ExtensionContext,
	selected: string,
): Promise<boolean> {
	const currentText = ctx.ui.getEditorText();
	if (!hasNonWhitespaceText(currentText)) {
		ctx.ui.setEditorText(selected);
		ctx.ui.notify("Inserted prompt", "info");
		return true;
	}

	const action = await ctx.ui.select("Insert prompt", [
		"Replace",
		"Append",
		"Cancel",
	]);
	if (action === "Replace") {
		ctx.ui.setEditorText(selected);
		ctx.ui.notify("Replaced editor with prompt", "info");
		return true;
	}
	if (action === "Append") {
		const separator =
			currentText.endsWith("\n") || selected.startsWith("\n") ? "" : "\n";
		ctx.ui.setEditorText(`${currentText}${separator}${selected}`);
		ctx.ui.notify("Appended prompt", "info");
		return true;
	}
	return false;
}
