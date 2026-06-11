import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

import {
	setDisplayConfig,
	type EventsConfig,
	type StatusWidgetPlacement,
} from "./events-config.ts";
import type { FixedEditorController } from "./fixed-editor/controller.ts";
import { STATUSLINE_WIDGET_ID } from "./statusline-identity.ts";

export interface DisplayState {
	footerHidden: boolean;
	statuslineEnabled: boolean;
	statusWidgetPlacement: StatusWidgetPlacement;
	fixedEditorEnabled: boolean;
	mouseScrollEnabled: boolean;
}

interface DisplayChangeDeps {
	getActiveTui: () => TUI | undefined;
	fixedEditorController: FixedEditorController;
	enableStatusline: (ctx: ExtensionContext) => void;
	disableStatusline: (ctx: ExtensionContext) => void;
	mountStatusWidget: (ctx: ExtensionContext) => void;
	hidePiFooter: (ctx: ExtensionContext) => void;
	restorePiFooter: (ctx: ExtensionContext) => void;
	requestRender: (force?: boolean) => void;
}

export function displayStateFromConfig(config: EventsConfig): DisplayState {
	return {
		footerHidden: config.display.footerHidden,
		statuslineEnabled: config.display.statuslineEnabled,
		statusWidgetPlacement: config.display.statusWidgetPlacement,
		fixedEditorEnabled: config.display.fixedEditorEnabled,
		mouseScrollEnabled: config.display.mouseScrollEnabled,
	};
}

export function applyStatuslineDisplayChange(
	config: EventsConfig,
	state: DisplayState,
	ctx: ExtensionContext,
	patch: Partial<EventsConfig["display"]>,
	deps: DisplayChangeDeps,
): EventsConfig {
	const nextConfig = setDisplayConfig(config, patch);
	const next = nextConfig.display;

	if ("statuslineEnabled" in patch)
		handleStatuslineChange(ctx, state, next, deps);
	if ("footerHidden" in patch) handleFooterChange(ctx, state, next, deps);
	if ("statusWidgetPlacement" in patch)
		handlePlacementChange(ctx, state, next, deps);
	if ("fixedEditorEnabled" in patch)
		handleFixedEditorChange(ctx, state, next, deps);
	if ("mouseScrollEnabled" in patch)
		handleMouseScrollChange(ctx, state, next, deps);
	if ("iconSet" in patch) deps.requestRender();

	return nextConfig;
}

function reinstallFixedEditor(
	ctx: ExtensionContext,
	state: DisplayState,
	deps: DisplayChangeDeps,
): void {
	const tui = deps.getActiveTui();
	if (!state.fixedEditorEnabled || !tui) return;
	deps.fixedEditorController.install(ctx, tui, state.mouseScrollEnabled);
}

function handleStatuslineChange(
	ctx: ExtensionContext,
	state: DisplayState,
	next: EventsConfig["display"],
	deps: DisplayChangeDeps,
): void {
	if (next.statuslineEnabled === state.statuslineEnabled) return;
	state.statuslineEnabled = next.statuslineEnabled;
	if (state.statuslineEnabled) deps.enableStatusline(ctx);
	else deps.disableStatusline(ctx);
}

function handleFooterChange(
	ctx: ExtensionContext,
	state: DisplayState,
	next: EventsConfig["display"],
	deps: DisplayChangeDeps,
): void {
	if (next.footerHidden === state.footerHidden) return;
	state.footerHidden = next.footerHidden;
	if (!state.statuslineEnabled) return;
	if (state.footerHidden) deps.hidePiFooter(ctx);
	else deps.restorePiFooter(ctx);
	reinstallFixedEditor(ctx, state, deps);
}

function handlePlacementChange(
	ctx: ExtensionContext,
	state: DisplayState,
	next: EventsConfig["display"],
	deps: DisplayChangeDeps,
): void {
	if (next.statusWidgetPlacement === state.statusWidgetPlacement) return;
	state.statusWidgetPlacement = next.statusWidgetPlacement;
	if (!state.statuslineEnabled) return;
	ctx.ui.setWidget(STATUSLINE_WIDGET_ID, undefined);
	deps.mountStatusWidget(ctx);
	deps.requestRender(true);
	reinstallFixedEditor(ctx, state, deps);
}

function handleFixedEditorChange(
	ctx: ExtensionContext,
	state: DisplayState,
	next: EventsConfig["display"],
	deps: DisplayChangeDeps,
): void {
	if (next.fixedEditorEnabled === state.fixedEditorEnabled) return;
	state.fixedEditorEnabled = next.fixedEditorEnabled;
	const tui = deps.getActiveTui();
	if (!state.statuslineEnabled || !tui) return;
	if (state.fixedEditorEnabled)
		deps.fixedEditorController.install(ctx, tui, state.mouseScrollEnabled);
	else {
		deps.fixedEditorController.teardown();
		tui.requestRender(true);
	}
}

function handleMouseScrollChange(
	ctx: ExtensionContext,
	state: DisplayState,
	next: EventsConfig["display"],
	deps: DisplayChangeDeps,
): void {
	if (next.mouseScrollEnabled === state.mouseScrollEnabled) return;
	state.mouseScrollEnabled = next.mouseScrollEnabled;
	reinstallFixedEditor(ctx, state, deps);
}
