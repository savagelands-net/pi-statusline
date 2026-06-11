import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorComponent } from "@earendil-works/pi-tui";

type EditorFactory = (
	tui: TUI,
	theme: EditorTheme,
	keybindings: KeybindingsManager,
) => EditorComponent;
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { NotifyStatusEvent } from "@wierdbytes/pi-events";

import { getGitStatus, invalidateGitStatus } from "./git-status.ts";
import {
	DEFAULT_STATUS_WIDGET_PLACEMENT,
	type EventsConfig,
	loadEventsConfig,
	setLayoutConfig,
	type StatusWidgetPlacement,
} from "./events-config.ts";
import type { IconSet } from "./icons.ts";
import {
	C_GRAY,
	C_RESET,
	composeStatusLine,
	levelColor,
	levelIcon,
	oneLine,
	shortenModelName,
	type RenderInputs,
} from "./blocks.ts";
import type { LayoutConfig } from "./layout-config.ts";
import { openStatuslineConfigOverlay } from "./config-overlay.ts";
import {
	printStatusDump,
	registerStatuslineCommand,
	type StatuslineCommandDeps,
} from "./statusline-commands.ts";
import { type ActiveToast, EventsTracker } from "./events-tracker.ts";
import { SubagentsTracker } from "./subagents-tracker.ts";
import { FixedEditorController } from "./fixed-editor/controller.ts";
import {
	applyStatuslineDisplayChange,
	displayStateFromConfig,
	type DisplayState,
} from "./display-changes.ts";
import type { TokenRateSnapshot } from "./token-rate.ts";
import { TokenRateCoordinator } from "./token-rate-coordinator.ts";
import { StashController } from "./stash-controller.ts";
import { STATUSLINE_WIDGET_ID } from "./statusline-identity.ts";

const PROMPT_PADDING = 0;

export const PROMPT_PREFIX = "❯";

export { DEFAULT_STATUS_WIDGET_PLACEMENT } from "./events-config.ts";

export interface RenderEditorLinesForStatuslineOptions {
	width?: number;
	promptPrefix?: string;
	continuationPrefix?: string;
}

function stripStatuslineAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x07]*\x07/g, "");
}

function isEditorBorderLine(line: string | undefined): boolean {
	return /^[─━]+\s*$/.test(stripStatuslineAnsi(line ?? ""));
}

function dropTopBorderForAboveEditor(
	lines: string[],
	placement: StatusWidgetPlacement,
): string[] {
	if (placement !== "aboveEditor") return lines;
	return isEditorBorderLine(lines[0]) ? lines.slice(1) : lines;
}

function firstEditorContentIndex(lines: string[]): number {
	return isEditorBorderLine(lines[0]) ? 1 : 0;
}

function bottomEditorBorderIndex(
	lines: string[],
	firstContentIndex: number,
): number {
	for (let i = lines.length - 1; i >= firstContentIndex; i--) {
		if (isEditorBorderLine(lines[i])) return i;
	}
	return lines.length;
}

function fitEditorLine(line: string, width: number | undefined): string {
	return typeof width === "number" && width > 0
		? truncateToWidth(line, width)
		: line;
}

function addPromptPrefixesToEditorLines(
	lines: string[],
	firstContentIndex: number,
	bottomBorderIndex: number,
	options: RenderEditorLinesForStatuslineOptions,
): void {
	const promptPrefix = options.promptPrefix ?? PROMPT_PREFIX;
	const continuationPrefix = options.continuationPrefix ?? " ";
	for (let i = firstContentIndex; i < bottomBorderIndex; i++) {
		const prefix = i === firstContentIndex ? promptPrefix : continuationPrefix;
		lines[i] = fitEditorLine(`${prefix} ${lines[i] ?? ""}`, options.width);
	}
}

export function renderEditorLinesForStatusline(
	lines: string[],
	placement: StatusWidgetPlacement = DEFAULT_STATUS_WIDGET_PLACEMENT,
	options: RenderEditorLinesForStatuslineOptions = {},
): string[] {
	const next = dropTopBorderForAboveEditor([...lines], placement);
	const firstContentIndex = firstEditorContentIndex(next);
	const bottomBorderIndex = bottomEditorBorderIndex(next, firstContentIndex);
	addPromptPrefixesToEditorLines(
		next,
		firstContentIndex,
		bottomBorderIndex,
		options,
	);
	return next;
}

/**
 * Render the toast row. Returns a width-padded line so it occupies a
 * full terminal row.
 *
 * Layout: `<icon> <colored source>:<reset> <title> [— <message>]`
 *   - `source` is always shown as the colored prefix so the user
 *     immediately knows which extension fired the toast.
 *   - `title` is the primary content (when present).
 *   - `message` is appended after a gray `—` separator when both are
 *     set; if `title` is omitted, `message` becomes the headline.
 *
 * The optional `×` hint is appended for sticky toasts (lifetime 0)
 * so the user knows the toast stays until dismissed.
 */
function buildToastLine(
	active: ActiveToast,
	width: number,
	set: IconSet,
): string {
	const event = active.event;
	const level = event.level ?? "info";
	const color = levelColor(level);
	const icon = event.icon || levelIcon(set, level);
	const sticky = !Number.isFinite(active.expiresAt);
	const hint = sticky ? ` ${C_GRAY}×${C_RESET}` : "";

	// Sanitize free-form payload fields before composition: a stray
	// newline would otherwise survive `truncateToWidth` and corrupt
	// the single-row toast layout. Source is also collapsed defensively
	// even though it's almost always a package name.
	const safeSource = oneLine(event.source);
	const safeTitle = event.title ? oneLine(event.title) : "";
	const safeMessage = oneLine(event.message);

	const head = `${color}${safeSource}${C_RESET}${C_GRAY}:${C_RESET}`;
	let tail: string;
	if (safeTitle && safeMessage) {
		tail = `${safeTitle} ${C_GRAY}—${C_RESET} ${safeMessage}`;
	} else if (safeTitle) {
		tail = safeTitle;
	} else {
		tail = safeMessage;
	}

	const body = `${icon} ${head} ${tail}${hint}`;
	const truncated = truncateToWidth(body, width, "…");
	const fillWidth = Math.max(0, width - visibleWidth(truncated));
	return truncated + " ".repeat(fillWidth);
}

function gatherStats(ctx: ExtensionContext) {
	let cost = 0;
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let lastAssistant: AssistantMessage | undefined;

	for (const e of ctx.sessionManager.getBranch()) {
		if (e.type === "message" && e.message.role === "assistant") {
			const m = e.message as AssistantMessage;
			cost += m.usage.cost.total;
			totalInput += m.usage.input;
			totalOutput += m.usage.output;
			totalCacheRead += m.usage.cacheRead;
			totalCacheWrite += m.usage.cacheWrite;
			if (
				m.usage.input +
					m.usage.output +
					m.usage.cacheRead +
					m.usage.cacheWrite >
				0
			) {
				lastAssistant = m;
			}
		}
	}

	return {
		cost,
		totalInput,
		totalOutput,
		totalCacheRead,
		totalCacheWrite,
		lastAssistant,
	};
}

function renderStatusContent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	width: number,
	stashCount: number,
	events: { chips: NotifyStatusEvent[]; toast: ActiveToast | null },
	tokenRate: TokenRateSnapshot | null,
	iconSet: IconSet,
	layout: LayoutConfig,
): string[] {
	const stats = gatherStats(ctx);
	const contextWindow =
		ctx.getContextUsage()?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const current = stats.lastAssistant
		? stats.lastAssistant.usage.input +
			stats.lastAssistant.usage.cacheRead +
			stats.lastAssistant.usage.cacheWrite
		: 0;
	const git = getGitStatus(ctx.cwd);

	const model = ctx.model as Model<any> | undefined;
	const inputs: RenderInputs = {
		cwd: ctx.cwd,
		branch: git.branch,
		dirty: git.dirty,
		current,
		contextWindow,
		cost: stats.cost,
		modelName: shortenModelName(ctx.model),
		thinkingLevel: pi.getThinkingLevel?.() ?? "off",
		thinkingLevelMap: model?.thinkingLevelMap,
		modelReasoning: ctx.model?.reasoning ?? false,
		totalInput: stats.totalInput,
		totalOutput: stats.totalOutput,
		totalCacheRead: stats.totalCacheRead,
		totalCacheWrite: stats.totalCacheWrite,
		tokenRate,
		stashCount,
		chips: events.chips,
		iconSet,
		layout,
	};
	const status = composeStatusLine(layout, inputs);

	const truncated = truncateToWidth(status, width);
	const fillWidth = Math.max(0, width - visibleWidth(truncated));
	const statusLine = truncated + `${C_GRAY}${"─".repeat(fillWidth)}${C_RESET}`;

	if (events.toast) {
		return [buildToastLine(events.toast, width, iconSet), statusLine];
	}
	return [statusLine];
}

function makeEditorFactory(
	ctx: ExtensionContext,
	setActiveTui: (tui: TUI | undefined) => void,
	setCurrentEditor: (editor: any) => void,
	onEditorMounted: (editor: any) => void,
	getPlacement: () => StatusWidgetPlacement,
): EditorFactory {
	return (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
		setActiveTui(tui);

		class WierdStatuslineEditor extends CustomEditor {
			constructor() {
				super(tui, theme, keybindings, { paddingX: PROMPT_PADDING });
			}

			setPaddingX(_value: number): void {
				super.setPaddingX(PROMPT_PADDING);
			}

			render(width: number): string[] {
				const lines = super.render(width);
				if (lines.length === 0) return lines;

				return renderEditorLinesForStatusline(lines, getPlacement(), {
					width,
					promptPrefix: ctx.ui.theme.fg("accent", PROMPT_PREFIX),
				});
			}
		}

		const editor = new WierdStatuslineEditor();
		const originalRender = editor.render.bind(editor);
		editor.render = (width: number): string[] => {
			const lines = originalRender(width);
			onEditorMounted(editor);
			return lines;
		};
		setCurrentEditor(editor);
		return editor;
	};
}

class EmptyFooter implements Component {
	render(): string[] {
		return [];
	}
	invalidate(): void {}
}

function hidePiFooter(ctx: ExtensionContext): void {
	ctx.ui.setFooter(() => new EmptyFooter());
}

function restorePiFooter(ctx: ExtensionContext): void {
	ctx.ui.setFooter(undefined);
}

function installStatusWidget(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	getStashCount: () => number,
	getEventsSnapshot: () => {
		chips: NotifyStatusEvent[];
		toast: ActiveToast | null;
	},
	getTokenRateSnapshot: () => TokenRateSnapshot | null,
	getIconSet: () => IconSet,
	getLayout: () => LayoutConfig,
	getPlacement: () => StatusWidgetPlacement,
) {
	ctx.ui.setWidget(
		STATUSLINE_WIDGET_ID,
		() => ({
			dispose() {},
			invalidate() {},
			render(width: number): string[] {
				return renderStatusContent(
					pi,
					ctx,
					width,
					getStashCount(),
					getEventsSnapshot(),
					getTokenRateSnapshot(),
					getIconSet(),
					getLayout(),
				);
			},
		}),
		{ placement: getPlacement() },
	);
}

interface RuntimeEventHandlers {
	getActiveTui: () => TUI | undefined;
	onShutdown: () => void;
	onAgentEnd: (ctx: ExtensionContext) => void;
	onSessionStart: (ctx: ExtensionContext) => void;
}

function registerRuntimeEvents(
	pi: ExtensionAPI,
	handlers: RuntimeEventHandlers,
): void {
	pi.on("thinking_level_select", () => {
		handlers.getActiveTui()?.requestRender();
	});

	pi.on("tool_result", () => {
		invalidateGitStatus();
		handlers.getActiveTui()?.requestRender();
	});

	pi.on("session_shutdown", () => handlers.onShutdown());
	pi.on("agent_end", (_event, ctx) => handlers.onAgentEnd(ctx));
	pi.on("session_start", async (_event, ctx) => handlers.onSessionStart(ctx));
}

interface StatuslineUiControlsArgs {
	pi: ExtensionAPI;
	fixedEditorController: FixedEditorController;
	eventsTracker: EventsTracker;
	stashController: StashController;
	getConfig: () => EventsConfig;
	getDisplayState: () => DisplayState;
	getEventsSnapshot: () => {
		chips: NotifyStatusEvent[];
		toast: ActiveToast | null;
	};
	getTokenRateSnapshot: () => TokenRateSnapshot | null;
}

class StatuslineUiControls {
	private activeTui: TUI | undefined;
	private currentCtx: ExtensionContext | undefined;
	private eventsTrackerOff: (() => void) | null = null;

	constructor(private readonly args: StatuslineUiControlsArgs) {}

	getActiveTui(): TUI | undefined {
		return this.activeTui;
	}

	setCurrentContext = (ctx: ExtensionContext): void => {
		this.currentCtx = ctx;
	};

	requestRender = (force?: boolean): void => {
		this.activeTui?.requestRender(force);
	};

	mountStatusWidget(ctx: ExtensionContext): void {
		installStatusWidget(
			this.args.pi,
			ctx,
			() => this.args.stashController.getCount(),
			this.args.getEventsSnapshot,
			this.args.getTokenRateSnapshot,
			() => this.args.getConfig().display.iconSet,
			() => this.args.getConfig().layout,
			() => this.args.getDisplayState().statusWidgetPlacement,
		);
	}

	enable(ctx: ExtensionContext): void {
		this.setCurrentContext(ctx);
		this.mountStatusWidget(ctx);
		ctx.ui.setEditorComponent(
			makeEditorFactory(
				ctx,
				this.setActiveTui,
				this.setCurrentEditor,
				this.tryInstallFixedEditor,
				() => this.args.getDisplayState().statusWidgetPlacement,
			),
		);
		if (this.args.getDisplayState().footerHidden) hidePiFooter(ctx);
		else restorePiFooter(ctx);
		this.attachEventsRenderHook();
		this.args.stashController.registerShortcuts(ctx);
	}

	disable(ctx: ExtensionContext): void {
		this.args.fixedEditorController.teardown();
		ctx.ui.setWidget(STATUSLINE_WIDGET_ID, undefined);
		ctx.ui.setEditorComponent(undefined);
		restorePiFooter(ctx);
		this.args.stashController.clearShortcut();
		this.detachEventsRenderHook();
		this.args.fixedEditorController.clearCurrentEditor();
	}

	shutdown(): void {
		this.args.fixedEditorController.teardown({
			resetExtendedKeyboardModes: true,
		});
		this.args.stashController.clearShortcut();
		this.detachEventsRenderHook();
	}

	private setActiveTui = (tui: TUI | undefined): void => {
		this.activeTui = tui;
	};

	private setCurrentEditor = (editor: any): void => {
		this.args.fixedEditorController.setCurrentEditor(editor);
	};

	private tryInstallFixedEditor = (): void => {
		const display = this.args.getDisplayState();
		this.args.fixedEditorController.tryInstall({
			ctx: this.currentCtx,
			tui: this.activeTui,
			statuslineEnabled: display.statuslineEnabled,
			fixedEditorEnabled: display.fixedEditorEnabled,
			mouseScrollEnabled: display.mouseScrollEnabled,
		});
	};

	private attachEventsRenderHook(): void {
		this.detachEventsRenderHook();
		this.eventsTrackerOff = this.args.eventsTracker.onChange(() =>
			this.requestRender(),
		);
		this.requestRender();
	}

	private detachEventsRenderHook(): void {
		this.eventsTrackerOff?.();
		this.eventsTrackerOff = null;
	}
}

function registerStatuslineLifecycle(
	pi: ExtensionAPI,
	displayState: DisplayState,
	uiControls: StatuslineUiControls,
	tokenRateCoordinator: TokenRateCoordinator,
	stashController: StashController,
): void {
	registerRuntimeEvents(pi, {
		getActiveTui: () => uiControls.getActiveTui(),
		onShutdown: () => uiControls.shutdown(),
		onAgentEnd: (ctx) => {
			tokenRateCoordinator.stopActive();
			stashController.restoreAfterAgentEnd(ctx);
		},
		onSessionStart: (ctx) => {
			if (displayState.statuslineEnabled) uiControls.enable(ctx);
		},
	});
}

interface CommandDepsArgs {
	getConfig: () => EventsConfig;
	getEventsSnapshot: () => {
		chips: NotifyStatusEvent[];
		toast: ActiveToast | null;
	};
	eventsTracker: EventsTracker;
	subagentsTracker: SubagentsTracker;
	tokenRateCoordinator: TokenRateCoordinator;
	uiControls: StatuslineUiControls;
	applyDisplayChange: StatuslineCommandDeps["applyDisplayChange"];
	applyLayoutChange: StatuslineCommandDeps["applyLayoutChange"];
	openConfigOverlay: StatuslineCommandDeps["openConfigOverlay"];
	getTokenRateSnapshot: () => TokenRateSnapshot | null;
}

function createStatuslineCommandDeps(
	args: CommandDepsArgs,
): StatuslineCommandDeps {
	return {
		getConfig: args.getConfig,
		getEventsSnapshot: args.getEventsSnapshot,
		getEventsLog: () => args.eventsTracker.getLog(),
		clearEvents: () => args.eventsTracker.clearAll(),
		getSubagentCounts: () => args.subagentsTracker.getCounts(),
		getTokenRateSnapshot: args.getTokenRateSnapshot,
		resetTokenRate: () => args.tokenRateCoordinator.reset(),
		applyDisplayChange: args.applyDisplayChange,
		applyLayoutChange: args.applyLayoutChange,
		openConfigOverlay: args.openConfigOverlay,
		setCurrentContext: (ctx) => args.uiControls.setCurrentContext(ctx),
	};
}

export default function (pi: ExtensionAPI) {
	const fixedEditorController = new FixedEditorController();

	// Persistent config + the events tracker need to be initialized before
	// the session-local toggle mirrors below, since those mirrors read
	// their initial values from `eventsConfig.display`.
	let eventsConfig: EventsConfig = loadEventsConfig();

	// Session-local mirrors of the persisted display config. Initialized
	// from disk so user preferences survive a restart; mutated only via
	// applyDisplayChange() below so the persistence + side-effects stay
	// in lockstep.
	const displayState = displayStateFromConfig(eventsConfig);

	let uiControls!: StatuslineUiControls;
	const stashController = new StashController({
		getStatuslineEnabled: () => displayState.statuslineEnabled,
		getActiveTui: () => uiControls.getActiveTui(),
	});

	// ───────────────────────── events tracker ─────────────────────────
	//
	// The tracker subscribes **eagerly at extension load time** — not
	// from `enableStatusline` — so we don't miss `notify:*` events that
	// sibling extensions emit from their own `session_start` handlers
	// when they happen to be loaded before us. Otherwise we'd race the
	// load order and the statusline could come up showing no chips even
	// though voice / web / etc. already announced their state.
	//
	// Rendering (`onChange → activeTui.requestRender()`) is still bound
	// to the statusline being mounted, since there's nothing to repaint
	// when the user has run `/statusline off`.

	const eventsTracker = new EventsTracker(pi, () => eventsConfig);
	eventsTracker.start();

	// ───────────────────────── subagents bridge ─────────────────────────
	//
	// Same eager-subscribe rationale as `eventsTracker`: pi-subagents
	// emits `subagents:created` / `started` etc. from its own session_start
	// handler, and depending on extension load order those can fire
	// before our `session_start` hook runs. Subscribing at extension
	// load means we never miss the very first agent of a session.
	//
	// The tracker doesn't render anything itself — it re-emits
	// `notify:status` (chip) and `notify:toast` events back onto the bus,
	// and the existing `eventsTracker` above picks them up and feeds the
	// chip / toast into the statusline like any other notify-event
	// emitter.
	const subagentsTracker = new SubagentsTracker(
		pi,
		() => eventsConfig.subagents,
		() => eventsConfig.display.iconSet,
	);
	subagentsTracker.start();

	const getEventsSnapshot = () => {
		const snap = eventsTracker.getSnapshot();
		return { chips: snap.chips, toast: snap.toast };
	};

	// ───────────────────────── token-rate tracker ─────────────────────────
	// Adapted from Cass67/tok-rate-footer: live output-rate estimation uses
	// streamed text / thinking / toolcall deltas; final rate prefers provider
	// usage output when the completed assistant message includes it.
	let tokenRateCoordinator!: TokenRateCoordinator;
	const getTokenRateSnapshot = () => tokenRateCoordinator.getSnapshot();

	uiControls = new StatuslineUiControls({
		pi,
		fixedEditorController,
		eventsTracker,
		stashController,
		getConfig: () => eventsConfig,
		getDisplayState: () => displayState,
		getEventsSnapshot,
		getTokenRateSnapshot,
	});

	tokenRateCoordinator = new TokenRateCoordinator({
		pi,
		getStatuslineEnabled: () => displayState.statuslineEnabled,
		getActiveTui: () => uiControls.getActiveTui(),
	});

	registerStatuslineLifecycle(
		pi,
		displayState,
		uiControls,
		tokenRateCoordinator,
		stashController,
	);

	// ────────────────────────── display-side-effect bus ───────────────────────
	//
	// Every Display field's `onChange` routes here so persistence + UI
	// side-effects fire together. The same code path runs for both the
	// settings modal and the imperative `on/off/toggle` subcommand.
	const applyDisplayChange = (
		ctx: ExtensionContext,
		patch: Partial<typeof eventsConfig.display>,
	): void => {
		eventsConfig = applyStatuslineDisplayChange(
			eventsConfig,
			displayState,
			ctx,
			patch,
			{
				getActiveTui: () => uiControls.getActiveTui(),
				fixedEditorController,
				enableStatusline: (ctx) => uiControls.enable(ctx),
				disableStatusline: (ctx) => uiControls.disable(ctx),
				mountStatusWidget: (ctx) => uiControls.mountStatusWidget(ctx),
				hidePiFooter,
				restorePiFooter,
				requestRender: (force) => uiControls.requestRender(force),
			},
		);
	};

	// Layout has no extra side-effects beyond persistence + repaint:
	// the composer reads `eventsConfig.layout` from the closure on
	// every render so a fresh paint is enough to show changes.
	const applyLayoutChange = (
		_ctx: ExtensionContext,
		patch: Partial<LayoutConfig>,
	): void => {
		eventsConfig = setLayoutConfig(eventsConfig, patch);
		uiControls.requestRender();
	};

	let statuslineCommandDeps: StatuslineCommandDeps;

	const openConfigOverlay = (ctx: ExtensionContext): Promise<void> =>
		openStatuslineConfigOverlay(ctx, {
			getConfig: () => eventsConfig,
			setConfig: (config) => {
				eventsConfig = config;
			},
			applyDisplayChange,
			applyLayoutChange,
			printStatusDump: (ctx) => printStatusDump(ctx, statuslineCommandDeps),
			resetSubagents: () => subagentsTracker.reset(),
		});

	// ────────────────────────── imperative helpers ────────────────────────────

	statuslineCommandDeps = createStatuslineCommandDeps({
		getConfig: () => eventsConfig,
		getEventsSnapshot,
		eventsTracker,
		subagentsTracker,
		tokenRateCoordinator,
		uiControls,
		applyDisplayChange,
		applyLayoutChange,
		openConfigOverlay,
		getTokenRateSnapshot,
	});

	registerStatuslineCommand(pi, statuslineCommandDeps);
}
