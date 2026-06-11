import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import {
	openSettingsModal,
	type CustomField,
	type CustomFieldSubmenuArgs,
	type Field,
	type FieldKeyHint,
} from "@wierdbytes/pi-common";
import type { NotifyLevel } from "@wierdbytes/pi-events";

import {
	blockHasSubSettings,
	createBlockSettingsSubmenu,
} from "./block-settings-submenu.ts";
import { type BlockId, KNOWN_BLOCK_IDS } from "./blocks.ts";
import {
	type EventsConfig,
	setSubagentsConfig,
	setToastTimeout,
	type StatusWidgetPlacement,
} from "./events-config.ts";
import {
	ICON_SET_DESCRIPTIONS,
	ICON_SET_LABELS,
	type IconSet,
	VALID_ICON_SETS,
} from "./icons.ts";
import {
	type LayoutConfig,
	SEPARATOR_LABELS,
	SEPARATOR_OPTIONS,
	type SeparatorOption,
} from "./layout-config.ts";

interface ConfigOverlayDeps {
	getConfig: () => EventsConfig;
	setConfig: (config: EventsConfig) => void;
	applyDisplayChange: (
		ctx: ExtensionContext,
		patch: Partial<EventsConfig["display"]>,
	) => void;
	applyLayoutChange: (
		ctx: ExtensionContext,
		patch: Partial<LayoutConfig>,
	) => void;
	printStatusDump: (ctx: ExtensionContext) => void;
	resetSubagents: () => void;
}

type BlockSettingsField = CustomField;

const BLOCK_LABELS: Record<BlockId, string> = {
	model: "Model & thinking",
	path: "Working directory",
	git: "Git branch",
	context: "Context usage",
	cost: "Session cost",
	tokens: "Token counters",
	rate: "Token rate",
	chips: "Notification chips",
	stash: "Stash count",
};

const BLOCK_DESCRIPTIONS: Record<BlockId, string> = {
	model:
		"`🤖 <model>` plus the optional inline `🧠 <level>` thinking segment. Enter to open submenu (visibility, show-thinking toggle, move actions). CLI id: `model`.",
	path: "Last three path segments of `cwd`. CLI id: `path`.",
	git: "Branch name plus a clean/dirty marker. CLI id: `git`.",
	context:
		"Percentage of usable context window (33k autocompact buffer reserved) with colored bar. CLI id: `context`.",
	cost: "Session total in USD when greater than zero. CLI id: `cost`.",
	tokens:
		"Cumulative `↑input ↓output R{cacheRead} W{cacheWrite}` counters. Enter to open submenu and toggle each one independently. CLI id: `tokens`.",
	rate: "Live/final assistant output speed in tok/s, estimated from stream deltas and finalized from provider usage when available. CLI id: `rate`.",
	chips:
		"Notify-status lane fed by `@wierdbytes/pi-events` consumers. CLI id: `chips`.",
	stash: "`📦 N` showing how many prompts are saved. CLI id: `stash`.",
};

const DISPLAY_TAB = "display";
const LAYOUT_TAB = "layout";
const TOASTS_TAB = "toasts";
const SUBAGENTS_TAB = "subagents";

const DISPLAY_FIELD_PATCHERS: Record<
	string,
	(value: unknown) => Partial<EventsConfig["display"]>
> = {
	statuslineEnabled: (value) => ({ statuslineEnabled: value as boolean }),
	footerHidden: (value) => ({ footerHidden: value as boolean }),
	statusWidgetPlacement: (value) => ({
		statusWidgetPlacement: value as StatusWidgetPlacement,
	}),
	fixedEditorEnabled: (value) => ({ fixedEditorEnabled: value as boolean }),
	mouseScrollEnabled: (value) => ({ mouseScrollEnabled: value as boolean }),
	iconSet: (value) => ({ iconSet: value as IconSet }),
};

const SUBAGENT_FIELD_PATCHERS: Record<
	string,
	(value: unknown) => Partial<EventsConfig["subagents"]>
> = {
	"sub.enabled": (value) => ({ enabled: value as boolean }),
	"sub.longCompletionMs": (value) => ({ longCompletionMs: value as number }),
	"sub.toastOnFailure": (value) => ({ toastOnFailure: value as boolean }),
	"sub.toastOnLongCompletion": (value) => ({
		toastOnLongCompletion: value as boolean,
	}),
	"sub.toastOnScheduled": (value) => ({ toastOnScheduled: value as boolean }),
};

function formatBlockValueCell(id: BlockId, deps: ConfigOverlayDeps): string {
	return deps.getConfig().layout.enabled[id] ? "[✓]" : "[ ]";
}

function buildBlockField(
	id: BlockId,
	ctx: ExtensionContext,
	deps: ConfigOverlayDeps,
): BlockSettingsField {
	const hasSubSettings = blockHasSubSettings(id);
	return {
		key: `layout.block.${id}`,
		type: "custom",
		tab: "layout",
		label: BLOCK_LABELS[id],
		description: BLOCK_DESCRIPTIONS[id],
		reorderable: true,
		dim: () => !deps.getConfig().layout.enabled[id],
		value: id,
		render: () => formatBlockValueCell(id, deps),
		handleInput: (data) => toggleBlockOnSpace(data, id, ctx, deps),
		hints: blockFieldHints(hasSubSettings),
		openSubmenu: hasSubSettings
			? createBlockSubmenuOpener(id, ctx, deps)
			: undefined,
	};
}

function toggleBlockOnSpace(
	data: string,
	id: BlockId,
	ctx: ExtensionContext,
	deps: ConfigOverlayDeps,
): boolean {
	if (data !== " " && !matchesKey(data, "space")) return false;
	const enabled = deps.getConfig().layout.enabled;
	deps.applyLayoutChange(ctx, { enabled: { ...enabled, [id]: !enabled[id] } });
	return true;
}

function blockFieldHints(hasSubSettings: boolean): FieldKeyHint[] {
	if (!hasSubSettings) return [{ key: "space", label: "toggle" }];
	return [
		{ key: "space", label: "toggle" },
		{ key: "enter", label: "settings" },
	];
}

function createBlockSubmenuOpener(
	id: BlockId,
	ctx: ExtensionContext,
	deps: ConfigOverlayDeps,
): NonNullable<BlockSettingsField["openSubmenu"]> {
	return ({ theme, tui, done }: CustomFieldSubmenuArgs<unknown>) =>
		createBlockSettingsSubmenu({
			blockId: id,
			getLayout: () => deps.getConfig().layout,
			title: BLOCK_LABELS[id],
			theme,
			tui,
			onChange: (patch) => deps.applyLayoutChange(ctx, patch),
			done: () => done(),
		});
}

function buildDisplayFields(display: EventsConfig["display"]): Field[] {
	return [
		{
			key: "statuslineEnabled",
			type: "boolean",
			tab: DISPLAY_TAB,
			label: "Statusline enabled",
			description: "Master switch for the savagelands statusline widget.",
			value: display.statuslineEnabled,
		},
		{
			key: "footerHidden",
			type: "boolean",
			tab: DISPLAY_TAB,
			label: "Hide pi footer",
			description:
				"Hide pi's built-in footer (we render our own statusline row).",
			value: display.footerHidden,
		},
		{
			key: "statusWidgetPlacement",
			type: "enum",
			tab: DISPLAY_TAB,
			label: "Statusline placement",
			description:
				"Place the statusline above the editor (upstream style) or below it with the editor bottom border as a divider.",
			value: display.statusWidgetPlacement,
			options: ["belowEditor", "aboveEditor"],
			optionLabels: {
				belowEditor: "Below prompt",
				aboveEditor: "Above prompt",
			},
		},
		{
			key: "fixedEditorEnabled",
			type: "boolean",
			tab: DISPLAY_TAB,
			label: "Fixed editor",
			description:
				"Pin the editor to the bottom of the terminal via the split compositor.",
			value: display.fixedEditorEnabled,
		},
		{
			key: "mouseScrollEnabled",
			type: "boolean",
			tab: DISPLAY_TAB,
			label: "Mouse scroll",
			description:
				"Let the fixed-editor compositor handle mouse-scroll events.",
			value: display.mouseScrollEnabled,
		},
		{
			key: "iconSet",
			type: "enum",
			tab: DISPLAY_TAB,
			label: "Icon set",
			description:
				"Glyphs used for model / thinking / stash / toast levels and the subagents chip. " +
				ICON_SET_DESCRIPTIONS[display.iconSet],
			value: display.iconSet,
			options: VALID_ICON_SETS,
			optionLabels: ICON_SET_LABELS,
		},
	];
}

function buildLayoutFields(
	layout: LayoutConfig,
	ctx: ExtensionContext,
	deps: ConfigOverlayDeps,
): Field[] {
	return [
		...layout.order.map((id) => buildBlockField(id, ctx, deps)),
		{
			key: "layout.separator",
			type: "enum",
			tab: LAYOUT_TAB,
			label: "Separator",
			description:
				"Glyph rendered between visible blocks. Hand-edit `events.json` for anything outside this list.",
			dim: false,
			value: (SEPARATOR_OPTIONS as readonly string[]).includes(layout.separator)
				? (layout.separator as SeparatorOption)
				: SEPARATOR_OPTIONS[0],
			options: SEPARATOR_OPTIONS,
			optionLabels: SEPARATOR_LABELS,
		},
	];
}

function buildToastFields(toasts: EventsConfig["toastTimeouts"]): Field[] {
	return [
		toastField("debug", "Debug", toasts.debug),
		toastField("info", "Info", toasts.info),
		toastField("success", "Success", toasts.success),
		toastField("warning", "Warning", toasts.warning),
		toastField("error", "Error", toasts.error),
	];
}

function toastField(level: NotifyLevel, label: string, value: number): Field {
	const sticky = level === "error" ? " (recommended)" : "";
	return {
		key: `toast.${level}`,
		type: "number",
		tab: TOASTS_TAB,
		label: `${label} (ms)`,
		description: `Toast lifetime for \`${level}\`-level events. 0 means sticky-until-dismissed${sticky}.`,
		value,
		min: 0,
		integer: true,
	};
}

function buildSubagentFields(subagents: EventsConfig["subagents"]): Field[] {
	return [
		{
			key: "sub.enabled",
			type: "boolean",
			tab: SUBAGENTS_TAB,
			label: "Subagents bridge",
			description:
				"Master switch. When off the tracker stays subscribed but silently drops every event from pi-subagents.",
			value: subagents.enabled,
		},
		{
			key: "sub.longCompletionMs",
			type: "number",
			tab: SUBAGENTS_TAB,
			label: "Long-completion threshold (ms)",
			description:
				"Minimum duration before a successful completion produces a toast. Failures still toast regardless.",
			value: subagents.longCompletionMs,
			min: 0,
			integer: true,
		},
		{
			key: "sub.toastOnFailure",
			type: "boolean",
			tab: SUBAGENTS_TAB,
			label: "Toast on failure",
			description:
				"Surface a toast for terminal-error states (failed / stopped / aborted).",
			value: subagents.toastOnFailure,
		},
		{
			key: "sub.toastOnLongCompletion",
			type: "boolean",
			tab: SUBAGENTS_TAB,
			label: "Toast on long completion",
			description:
				"Surface a toast when a non-error completion's duration exceeds the threshold above.",
			value: subagents.toastOnLongCompletion,
		},
		{
			key: "sub.toastOnScheduled",
			type: "boolean",
			tab: SUBAGENTS_TAB,
			label: "Toast on scheduled",
			description:
				"Audit-trail toasts when a subagent is scheduled (cron / interval / one-shot). Off by default to avoid noise.",
			value: subagents.toastOnScheduled,
		},
	];
}

function buildConfigFields(
	ctx: ExtensionContext,
	deps: ConfigOverlayDeps,
): Field[] {
	const config = deps.getConfig();
	return [
		...buildDisplayFields(config.display),
		...buildLayoutFields(config.layout, ctx, deps),
		...buildToastFields(config.toastTimeouts),
		...buildSubagentFields(config.subagents),
	];
}

function applyDisplayFieldChange(
	ctx: ExtensionContext,
	key: string,
	value: unknown,
	deps: ConfigOverlayDeps,
): boolean {
	const toPatch = DISPLAY_FIELD_PATCHERS[key];
	if (!toPatch) return false;
	deps.applyDisplayChange(ctx, toPatch(value));
	return true;
}

function applyLayoutFieldChange(
	ctx: ExtensionContext,
	key: string,
	value: unknown,
	deps: ConfigOverlayDeps,
): boolean {
	if (key === "layout.separator") {
		deps.applyLayoutChange(ctx, { separator: value as string });
		return true;
	}
	return key.startsWith("layout.block.");
}

function applyToastFieldChange(
	key: string,
	value: unknown,
	deps: ConfigOverlayDeps,
): boolean {
	if (!key.startsWith("toast.")) return false;
	const level = key.slice("toast.".length) as NotifyLevel;
	deps.setConfig(setToastTimeout(deps.getConfig(), level, value as number));
	return true;
}

function applySubagentFieldChange(
	key: string,
	value: unknown,
	deps: ConfigOverlayDeps,
): boolean {
	const toPatch = SUBAGENT_FIELD_PATCHERS[key];
	if (!toPatch) return false;
	const patch = toPatch(value);
	deps.setConfig(setSubagentsConfig(deps.getConfig(), patch));
	if (patch.enabled === false) deps.resetSubagents();
	return true;
}

function handleConfigChange(
	ctx: ExtensionContext,
	key: string,
	value: unknown,
	deps: ConfigOverlayDeps,
): void {
	if (applyDisplayFieldChange(ctx, key, value, deps)) return;
	if (applyLayoutFieldChange(ctx, key, value, deps)) return;
	if (applyToastFieldChange(key, value, deps)) return;
	applySubagentFieldChange(key, value, deps);
}

function handleLayoutReorder(
	ctx: ExtensionContext,
	deps: ConfigOverlayDeps,
	change: { fieldKey: string; fromIndex: number; toIndex: number },
): void {
	if (!change.fieldKey.startsWith("layout.block.")) return;
	const id = change.fieldKey.slice("layout.block.".length) as BlockId;
	if (!(KNOWN_BLOCK_IDS as readonly string[]).includes(id)) return;

	const order = [...deps.getConfig().layout.order];
	const cur = order.indexOf(id);
	const actualFrom = cur >= 0 ? cur : change.fromIndex;
	const safeTo = Math.max(0, Math.min(order.length - 1, change.toIndex));
	if (actualFrom === safeTo) return;

	order.splice(actualFrom, 1);
	order.splice(safeTo, 0, id);
	deps.applyLayoutChange(ctx, { order });
}

export async function openStatuslineConfigOverlay(
	ctx: ExtensionContext,
	deps: ConfigOverlayDeps,
): Promise<void> {
	if (!ctx.hasUI) {
		deps.printStatusDump(ctx);
		return;
	}

	await openSettingsModal(ctx, {
		title: "@savagelands-net/pi-statusline",
		tabs: [
			{ id: DISPLAY_TAB, label: "Display" },
			{ id: LAYOUT_TAB, label: "Layout" },
			{ id: TOASTS_TAB, label: "Toasts" },
			{ id: SUBAGENTS_TAB, label: "Subagents" },
		],
		initialTab: DISPLAY_TAB,
		fields: buildConfigFields(ctx, deps),
		onReorder: (change) => handleLayoutReorder(ctx, deps, change),
		onChange: (key, value) => handleConfigChange(ctx, String(key), value, deps),
	});
}
