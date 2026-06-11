import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	NotifyStatusEvent,
	NotifyToastEvent,
} from "@wierdbytes/pi-events";

import type { ActiveToast } from "./events-tracker.ts";
import { type BlockId, KNOWN_BLOCK_IDS, shortenModelName } from "./blocks.ts";
import type { EventsConfig, StatusWidgetPlacement } from "./events-config.ts";
import { ICON_SET_LABELS, isIconSet, VALID_ICON_SETS } from "./icons.ts";
import type { LayoutConfig } from "./layout-config.ts";
import {
	formatTokenRate,
	parseTokenRateCommand,
	rateFromTokenRateSnapshot,
	type TokenRateSnapshot,
} from "./token-rate.ts";

export interface StatuslineCommandDeps {
	getConfig: () => EventsConfig;
	getEventsSnapshot: () => {
		chips: NotifyStatusEvent[];
		toast: ActiveToast | null;
	};
	getEventsLog: () => NotifyToastEvent[];
	clearEvents: () => void;
	getSubagentCounts: () => { running: number; created: number; total: number };
	getTokenRateSnapshot: () => TokenRateSnapshot | null;
	resetTokenRate: () => void;
	applyDisplayChange: (
		ctx: ExtensionContext,
		patch: Partial<EventsConfig["display"]>,
	) => void;
	applyLayoutChange: (
		ctx: ExtensionContext,
		patch: Partial<LayoutConfig>,
	) => void;
	openConfigOverlay: (ctx: ExtensionContext) => Promise<void>;
	setCurrentContext: (ctx: ExtensionContext) => void;
}

type StatuslineCommandHandler = (
	ctx: ExtensionContext,
	tokens: string[],
) => void | Promise<void>;

const STATUSLINE_USAGE =
	"Usage: /statusline [on|off|toggle|status|placement [above|below]|icons [set]|rate [status|on|off|reset]|layout [status|reset|toggle <block>|move <block> <dir>]|events log|events clear]  (no args ⇒ open settings overlay)";

function onOff(enabled: boolean): string {
	return enabled ? "on" : "off";
}

function yesNo(enabled: boolean): string {
	return enabled ? "yes" : "no";
}

function isKnownBlockId(value: string | undefined): value is BlockId {
	return (
		typeof value === "string" &&
		(KNOWN_BLOCK_IDS as readonly string[]).includes(value)
	);
}

function parseStatusWidgetPlacement(
	value: string | undefined,
): StatusWidgetPlacement | null {
	if (value === "below" || value === "belowEditor") return "belowEditor";
	if (value === "above" || value === "aboveEditor") return "aboveEditor";
	return null;
}

function formatStatusWidgetPlacement(placement: StatusWidgetPlacement): string {
	return placement === "belowEditor" ? "below prompt" : "above prompt";
}

function formatLayoutLine(config: EventsConfig): string {
	const { order, enabled } = config.layout;
	const total = KNOWN_BLOCK_IDS.length;
	const visible = order.filter((id) => enabled[id]).length;
	const pieces = order.map((id) => (enabled[id] ? id : `${id}!`));
	return `${pieces.join(" > ")} (${visible}/${total} visible)`;
}

function formatTokenRateStatus(
	ctx: ExtensionContext,
	deps: StatuslineCommandDeps,
): string {
	const snapshot = deps.getTokenRateSnapshot();
	if (!snapshot) return `${shortenModelName(ctx.model)}: -- tok/s`;
	const rate = snapshot.finalRate ?? rateFromTokenRateSnapshot(snapshot);
	const state = snapshot.active ? "live" : "final";
	return `${snapshot.model}: ${formatTokenRate(rate)} tok/s (${state})`;
}

function formatToastStatusLine(toast: ActiveToast | null): string {
	if (!toast) return "(none)";
	return `${toast.event.level ?? "info"} — ${toast.event.message}`;
}

function formatToastTimeouts(config: EventsConfig): string {
	return Object.entries(config.toastTimeouts)
		.map(([level, ms]) => `${level}=${ms === 0 ? "sticky" : `${ms}ms`}`)
		.join(" ");
}

function formatTokenToggleLine(layout: LayoutConfig): string {
	return [
		layout.tokens.input ? "in" : "-in",
		layout.tokens.output ? "out" : "-out",
		layout.tokens.cacheRead ? "R" : "-R",
		layout.tokens.cacheWrite ? "W" : "-W",
	].join(" ");
}

function formatSubagentsSummary(
	config: EventsConfig,
	deps: StatuslineCommandDeps,
): string {
	const counts = deps.getSubagentCounts();
	const state = onOff(config.subagents.enabled);
	return `${state} (${counts.running} running / ${counts.created} queued / ${counts.total} total)`;
}

export function printStatusDump(
	ctx: ExtensionContext,
	deps: StatuslineCommandDeps,
): void {
	const config = deps.getConfig();
	const snap = deps.getEventsSnapshot();
	const display = config.display;
	const subagents = config.subagents;
	const layout = config.layout;
	const lines = [
		`statusline:    ${onOff(display.statuslineEnabled)}`,
		`footer:        ${display.footerHidden ? "hidden" : "shown"}`,
		`placement:     ${formatStatusWidgetPlacement(display.statusWidgetPlacement)}`,
		`fixed editor:  ${onOff(display.fixedEditorEnabled)}`,
		`mouse scroll:  ${onOff(display.mouseScrollEnabled)}`,
		`icon set:      ${display.iconSet}`,
		`token rate:    ${formatTokenRateStatus(ctx, deps)}`,
		`chips:         ${snap.chips.length}`,
		`toast:         ${formatToastStatusLine(snap.toast)}`,
		`events log:    ${deps.getEventsLog().length} entries`,
		`toast timeouts: ${formatToastTimeouts(config)}`,
		`layout:        ${formatLayoutLine(config)}`,
		`  separator:   ${JSON.stringify(layout.separator)}`,
		`  model.think: ${yesNo(layout.model.showThinking)}`,
		`  tokens:      ${formatTokenToggleLine(layout)}`,
		`subagents:     ${formatSubagentsSummary(config, deps)}`,
		`  long-ms:     ${subagents.longCompletionMs}`,
		`  on failure: ${yesNo(subagents.toastOnFailure)}`,
		`  on long:    ${yesNo(subagents.toastOnLongCompletion)}`,
		`  on schedule: ${yesNo(subagents.toastOnScheduled)}`,
	];
	ctx.ui.notify(lines.join("\n"), "info");
}

function notifyUnknownBlock(
	ctx: ExtensionContext,
	id: string | undefined,
): void {
	ctx.ui.notify(
		`Unknown block: ${id ?? "(none)"}. Valid: ${KNOWN_BLOCK_IDS.join(", ")}`,
		"warning",
	);
}

function resetLayout(ctx: ExtensionContext, deps: StatuslineCommandDeps): void {
	deps.applyLayoutChange(ctx, {
		order: [...KNOWN_BLOCK_IDS],
		enabled: KNOWN_BLOCK_IDS.reduce(
			(acc, id) => {
				acc[id] = true;
				return acc;
			},
			{} as Record<BlockId, boolean>,
		),
		model: { showThinking: true },
		tokens: { input: true, output: true, cacheRead: true, cacheWrite: true },
	});
	ctx.ui.notify("layout: reset to defaults", "info");
}

function toggleLayoutBlock(
	ctx: ExtensionContext,
	id: string | undefined,
	deps: StatuslineCommandDeps,
): void {
	if (!isKnownBlockId(id)) return notifyUnknownBlock(ctx, id);
	const enabled = deps.getConfig().layout.enabled;
	const next = !enabled[id];
	deps.applyLayoutChange(ctx, { enabled: { ...enabled, [id]: next } });
	ctx.ui.notify(`layout: ${id} ${next ? "enabled" : "disabled"}`, "info");
}

function layoutMoveTarget(
	direction: string | undefined,
	index: number,
	count: number,
): number {
	if (direction === "up") return Math.max(0, index - 1);
	if (direction === "down") return Math.min(count - 1, index + 1);
	if (direction === "top") return 0;
	if (direction === "bottom") return count - 1;
	return -1;
}

function moveLayoutBlock(
	ctx: ExtensionContext,
	id: string | undefined,
	direction: string | undefined,
	deps: StatuslineCommandDeps,
): void {
	if (!isKnownBlockId(id)) return notifyUnknownBlock(ctx, id);
	const order = [...deps.getConfig().layout.order];
	const idx = order.indexOf(id);
	if (idx < 0) return;

	const target = layoutMoveTarget(direction, idx, order.length);
	if (target < 0) {
		ctx.ui.notify(
			"Usage: /statusline layout move <block> <up|down|top|bottom>",
			"warning",
		);
		return;
	}

	order.splice(idx, 1);
	order.splice(target, 0, id);
	deps.applyLayoutChange(ctx, { order });
	ctx.ui.notify(`layout: moved ${id} → position ${target + 1}`, "info");
}

function handleLayoutCommand(
	ctx: ExtensionContext,
	tokens: string[],
	deps: StatuslineCommandDeps,
): void {
	const sub = tokens[0];
	if (!sub || sub === "status" || sub === "print") {
		ctx.ui.notify(`layout: ${formatLayoutLine(deps.getConfig())}`, "info");
		return;
	}
	if (sub === "reset") return resetLayout(ctx, deps);
	if (sub === "toggle") return toggleLayoutBlock(ctx, tokens[1], deps);
	if (sub === "move") return moveLayoutBlock(ctx, tokens[1], tokens[2], deps);
	ctx.ui.notify(
		"Usage: /statusline layout [status|reset|toggle <block>|move <block> <up|down|top|bottom>]",
		"info",
	);
}

function setRateBlockEnabled(
	ctx: ExtensionContext,
	enabled: boolean,
	deps: StatuslineCommandDeps,
): void {
	const layoutEnabled = deps.getConfig().layout.enabled;
	deps.applyLayoutChange(ctx, { enabled: { ...layoutEnabled, rate: enabled } });
}

function printEventsLog(
	ctx: ExtensionContext,
	deps: StatuslineCommandDeps,
): void {
	const log = deps.getEventsLog().slice(0, 16);
	if (log.length === 0) {
		ctx.ui.notify("events: log is empty", "info");
		return;
	}
	const formatted = log.map(formatEventLogEntry).join("\n");
	ctx.ui.notify(formatted, "info");
}

function formatEventLogEntry(e: NotifyToastEvent): string {
	const ts = e.timestamp
		? new Date(e.timestamp).toISOString().slice(11, 19)
		: "--:--:--";
	const level = e.level ?? "info";
	const title = e.title || e.source;
	return `${ts} [${level}] ${title}: ${e.message}`;
}

function handleRateCommand(
	ctx: ExtensionContext,
	tokens: string[],
	deps: StatuslineCommandDeps,
): void {
	const action = parseTokenRateCommand(tokens);
	if (action === "off") {
		setRateBlockEnabled(ctx, false, deps);
		ctx.ui.notify("token-rate block disabled", "info");
		return;
	}
	if (action === "on") {
		setRateBlockEnabled(ctx, true, deps);
		ctx.ui.notify("token-rate block enabled", "info");
		return;
	}
	if (action === "reset") {
		deps.resetTokenRate();
		ctx.ui.notify("token-rate reset", "info");
		return;
	}
	if (action === "status") {
		ctx.ui.notify(formatTokenRateStatus(ctx, deps), "info");
		return;
	}
	ctx.ui.notify("Usage: /statusline rate [on|off|reset|status]", "warning");
}

function handleStatuslineSwitch(
	ctx: ExtensionContext,
	action: "on" | "off" | "toggle",
	deps: StatuslineCommandDeps,
): void {
	const enabled = deps.getConfig().display.statuslineEnabled;
	const next = action === "toggle" ? !enabled : action === "on";
	deps.applyDisplayChange(ctx, { statuslineEnabled: next });
	ctx.ui.notify(
		`savagelands statusline ${next ? "enabled" : "disabled"}`,
		"info",
	);
}

function handlePlacementCommand(
	ctx: ExtensionContext,
	tokens: string[],
	deps: StatuslineCommandDeps,
): void {
	const sub = tokens[0];
	const current = deps.getConfig().display.statusWidgetPlacement;
	if (!sub || sub === "status") {
		ctx.ui.notify(`placement: ${formatStatusWidgetPlacement(current)}`, "info");
		return;
	}
	const next = parseStatusWidgetPlacement(sub);
	if (!next) {
		ctx.ui.notify("Usage: /statusline placement <above|below>", "warning");
		return;
	}
	deps.applyDisplayChange(ctx, { statusWidgetPlacement: next });
	ctx.ui.notify(`placement: ${formatStatusWidgetPlacement(next)}`, "info");
}

function printIconSetStatus(
	ctx: ExtensionContext,
	deps: StatuslineCommandDeps,
): void {
	const current = deps.getConfig().display.iconSet;
	const lines = [
		`current: ${current}`,
		"available:",
		...VALID_ICON_SETS.map(
			(s) =>
				`  ${s === current ? "*" : " "} ${s.padEnd(10)} — ${ICON_SET_LABELS[s]}`,
		),
	];
	ctx.ui.notify(lines.join("\n"), "info");
}

function handleIconsCommand(
	ctx: ExtensionContext,
	tokens: string[],
	deps: StatuslineCommandDeps,
): void {
	const sub = tokens[0];
	if (!sub || sub === "status") return printIconSetStatus(ctx, deps);
	if (!isIconSet(sub)) {
		ctx.ui.notify(
			`Unknown icon set: ${sub}. Valid: ${VALID_ICON_SETS.join(" | ")}`,
			"warning",
		);
		return;
	}
	deps.applyDisplayChange(ctx, { iconSet: sub });
	ctx.ui.notify(`icon set: ${sub} (${ICON_SET_LABELS[sub]})`, "info");
}

function handleEventsCommand(
	ctx: ExtensionContext,
	tokens: string[],
	deps: StatuslineCommandDeps,
): void {
	const sub = tokens[0];
	if (sub === "log") return printEventsLog(ctx, deps);
	if (sub === "clear") {
		deps.clearEvents();
		ctx.ui.notify("events: cleared chips and toast", "info");
		return;
	}
	ctx.ui.notify("Usage: /statusline events [log|clear]", "info");
}

function commandHandlers(
	deps: StatuslineCommandDeps,
): Record<string, StatuslineCommandHandler> {
	return {
		on: (ctx) => handleStatuslineSwitch(ctx, "on", deps),
		off: (ctx) => handleStatuslineSwitch(ctx, "off", deps),
		toggle: (ctx) => handleStatuslineSwitch(ctx, "toggle", deps),
		status: (ctx) => printStatusDump(ctx, deps),
		placement: (ctx, tokens) => handlePlacementCommand(ctx, tokens, deps),
		icons: (ctx, tokens) => handleIconsCommand(ctx, tokens, deps),
		rate: (ctx, tokens) => handleRateCommand(ctx, tokens, deps),
		layout: (ctx, tokens) => handleLayoutCommand(ctx, tokens, deps),
		events: (ctx, tokens) => handleEventsCommand(ctx, tokens, deps),
	};
}

export function registerStatuslineCommand(
	pi: ExtensionAPI,
	deps: StatuslineCommandDeps,
): void {
	const handlers = commandHandlers(deps);
	pi.registerCommand("statusline", {
		description:
			"Open the @savagelands-net/pi-statusline settings overlay (no args). Action subcommands: on | off | toggle | status | placement [above|below] | icons [set] | rate [...] | layout [...] | events log | events clear",
		handler: async (args, ctx) => {
			deps.setCurrentContext(ctx);
			const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const cmd = tokens[0];
			if (!cmd) {
				await deps.openConfigOverlay(ctx);
				return;
			}

			const handler = handlers[cmd];
			if (!handler) {
				ctx.ui.notify(STATUSLINE_USAGE, "info");
				return;
			}
			await handler(ctx, tokens.slice(1));
		},
	});
}
