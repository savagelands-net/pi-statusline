import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey, type TUI } from "@earendil-works/pi-tui";

import {
	hasNonWhitespaceText,
	insertStashHistoryEntry,
	persistStashHistory,
	pushStashHistoryEntry,
	readPersistedStashHistory,
	showStashHistoryOverlay,
} from "./stash-history.ts";

interface StashControllerArgs {
	getStatuslineEnabled: () => boolean;
	getActiveTui: () => TUI | undefined;
}

function isStashShortcutInput(data: string): boolean {
	if (isKeyRelease(data)) return false;
	return (
		data === "ß" ||
		data === "\x1bs" ||
		data === "\x1bS" ||
		/^\x1b\[(?:83|115)(?::\d*)?(?::\d*)?;3(?::\d+)?u$/.test(data) ||
		data === "\x1b[27;3;115~" ||
		data === "\x1b[27;3;83~" ||
		matchesKey(data, "alt+s")
	);
}

function isStashHistoryShortcutInput(data: string): boolean {
	if (isKeyRelease(data)) return false;
	return (
		matchesKey(data, "ctrl+alt+s") ||
		/^\x1b\[(?:115|83)(?::\d*)?(?::\d*)?;7(?::\d+)?u$/.test(data) ||
		data === "\x1b[27;7;115~" ||
		data === "\x1b[27;7;83~"
	);
}

export class StashController {
	private stashedEditorText: string | null = null;
	private readonly history = readPersistedStashHistory();
	private unsubscribe: (() => void) | null = null;

	constructor(private readonly args: StashControllerArgs) {}

	getCount(): number {
		return this.history.length;
	}

	registerShortcuts(ctx: ExtensionContext): void {
		this.clearShortcut();
		this.unsubscribe =
			typeof ctx.ui.onTerminalInput === "function"
				? ctx.ui.onTerminalInput((data) => this.handleTerminalInput(data, ctx))
				: null;
	}

	clearShortcut(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	restoreAfterAgentEnd(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (this.stashedEditorText === null) return;
		if (ctx.ui.getEditorText().trim() !== "") {
			ctx.ui.notify(
				"Stash preserved — clear editor then Alt+S to restore",
				"info",
			);
			return;
		}
		const popped = this.popLatest();
		if (popped === null) return;
		ctx.ui.setEditorText(popped);
		ctx.ui.notify("Stash restored", "info");
		this.requestRender();
	}

	private handleTerminalInput(
		data: string,
		ctx: ExtensionContext,
	): { consume: true } | undefined {
		const tui = this.args.getActiveTui();
		if (!this.args.getStatuslineEnabled() || !ctx.hasUI || tui?.hasOverlay?.())
			return undefined;
		if (isStashShortcutInput(data)) {
			this.stashOrRestore(ctx);
			this.requestRender();
			return { consume: true };
		}
		if (isStashHistoryShortcutInput(data)) {
			void this.openHistoryPicker(ctx);
			return { consume: true };
		}
		return undefined;
	}

	private removeEntry(text: string): void {
		const idx = this.history.indexOf(text);
		if (idx >= 0) {
			this.history.splice(idx, 1);
			persistStashHistory(this.history);
		}
		if (this.stashedEditorText === text) this.stashedEditorText = null;
	}

	private popLatest(): string | null {
		const text = this.stashedEditorText ?? this.history[0] ?? null;
		if (text !== null) this.removeEntry(text);
		return text;
	}

	private stashOrRestore(ctx: ExtensionContext): void {
		const rawText = ctx.ui.getEditorText();
		if (!hasNonWhitespaceText(rawText)) {
			this.restoreLatest(ctx);
			return;
		}
		this.stashText(ctx, rawText);
	}

	private restoreLatest(ctx: ExtensionContext): void {
		const popped = this.popLatest();
		if (popped === null) {
			ctx.ui.notify("Nothing to stash", "info");
			return;
		}
		ctx.ui.setEditorText(popped);
		ctx.ui.notify("Stash restored", "info");
		this.requestRender();
	}

	private stashText(ctx: ExtensionContext, rawText: string): void {
		const hadStash = this.stashedEditorText !== null;
		this.stashedEditorText = rawText;
		if (pushStashHistoryEntry(this.history, rawText))
			persistStashHistory(this.history);
		ctx.ui.setEditorText("");
		ctx.ui.notify(hadStash ? "Stash updated" : "Text stashed", "info");
		this.requestRender();
	}

	private async openHistoryPicker(ctx: ExtensionContext): Promise<void> {
		if (this.history.length === 0) {
			ctx.ui.notify("No stashed prompts yet", "info");
			return;
		}
		const selected = await showStashHistoryOverlay(
			ctx,
			[...this.history],
			(text) => this.removeEntry(text),
		);
		if (selected && (await insertStashHistoryEntry(ctx, selected)))
			this.removeEntry(selected);
		this.requestRender();
	}

	private requestRender(): void {
		this.args.getActiveTui()?.requestRender();
	}
}
