import {
	copyToClipboard,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";

import {
	renderFixedEditorCluster,
	type FixedEditorClusterRender,
} from "./cluster.ts";
import {
	emergencyTerminalModeReset,
	TerminalSplitCompositor,
} from "./terminal-split.ts";

interface ContainerMatch {
	container: any;
	index: number;
}

interface TryInstallArgs {
	ctx: ExtensionContext | undefined;
	tui: TUI | undefined;
	statuslineEnabled: boolean;
	fixedEditorEnabled: boolean;
	mouseScrollEnabled: boolean;
}

function findContainerWithChild(tui: any, child: any): ContainerMatch | null {
	const children = Array.isArray(tui?.children) ? tui.children : [];
	const index = children.findIndex(
		(candidate: any) =>
			Array.isArray(candidate?.children) && candidate.children.includes(child),
	);
	if (index === -1) return null;
	return { container: children[index], index };
}

function isRenderable(candidate: any): boolean {
	return candidate && typeof candidate.render === "function";
}

export class FixedEditorController {
	private compositor: TerminalSplitCompositor | null = null;
	private editorContainer: any = null;
	private statusContainer: any = null;
	private widgetContainerAbove: any = null;
	private widgetContainerBelow: any = null;
	private footerComponent: any = null;
	private currentEditor: any = null;

	setCurrentEditor(editor: any): void {
		this.currentEditor = editor;
	}

	clearCurrentEditor(): void {
		this.currentEditor = null;
	}

	tryInstall(args: TryInstallArgs): void {
		if (!args.statuslineEnabled) return;
		if (!args.fixedEditorEnabled) return;
		if (this.compositor) return;
		if (!args.ctx || !args.tui) return;
		if (!this.currentEditor) return;
		if (!findContainerWithChild(args.tui, this.currentEditor)) return;
		this.install(args.ctx, args.tui, args.mouseScrollEnabled);
	}

	teardown(options?: { resetExtendedKeyboardModes?: boolean }): void {
		const hadCompositor = this.compositor !== null;
		this.compositor?.dispose(options);
		if (!hadCompositor && options?.resetExtendedKeyboardModes)
			this.emergencyResetTerminalMode();
		this.clearCapturedRenderables();
	}

	install(ctx: ExtensionContext, tui: TUI, mouseScrollEnabled: boolean): void {
		this.teardown();
		if (!this.canInstall(ctx, tui)) return;

		const match = findContainerWithChild(tui, this.currentEditor);
		if (!match) return;

		this.captureRenderables(tui, match);
		const compositor = this.createCompositor(tui, { mouseScrollEnabled });
		this.compositor = compositor;
		this.hideCapturedRenderables(compositor);
		compositor.install();
		tui.requestRender(true);
	}

	private canInstall(ctx: ExtensionContext, tui: any): boolean {
		if (!ctx.hasUI) return false;
		if (!tui?.terminal || typeof tui.terminal.write !== "function")
			return false;
		return Boolean(this.currentEditor);
	}

	private captureRenderables(tui: any, match: ContainerMatch): void {
		const children = Array.isArray(tui.children) ? tui.children : [];
		this.editorContainer = match.container;
		this.statusContainer = this.renderableAt(children, match.index - 2);
		this.widgetContainerAbove = children[match.index - 1] ?? null;
		this.widgetContainerBelow = children[match.index + 1] ?? null;
		this.footerComponent = this.renderableAt(children, match.index + 2);
	}

	private renderableAt(children: any[], index: number): any {
		const candidate = children[index] ?? null;
		return isRenderable(candidate) ? candidate : null;
	}

	private createCompositor(
		tui: any,
		options: { mouseScrollEnabled: boolean },
	): TerminalSplitCompositor {
		let compositor: TerminalSplitCompositor;
		compositor = new TerminalSplitCompositor({
			tui,
			terminal: tui.terminal,
			mouseScroll: options.mouseScrollEnabled,
			onCopySelection: (text) => {
				void copyToClipboard(text).catch(() => {});
			},
			getShowHardwareCursor: () =>
				typeof tui.getShowHardwareCursor === "function" &&
				tui.getShowHardwareCursor(),
			renderCluster: (width, terminalRows) =>
				this.renderCluster(compositor, width, terminalRows),
		});
		return compositor;
	}

	private renderCluster(
		compositor: TerminalSplitCompositor,
		width: number,
		terminalRows: number,
	): FixedEditorClusterRender {
		return renderFixedEditorCluster({
			width,
			terminalRows,
			statusLines: [
				...this.visibleLines(compositor, this.statusContainer, width),
				...this.hiddenLines(compositor, this.widgetContainerAbove, width),
			],
			editorLines: this.hiddenLines(compositor, this.editorContainer, width),
			secondaryLines: [
				...this.hiddenLines(compositor, this.widgetContainerBelow, width),
				...this.visibleLines(compositor, this.footerComponent, width),
			],
		});
	}

	private hiddenLines(
		compositor: TerminalSplitCompositor,
		renderable: any,
		width: number,
	): string[] {
		return renderable ? compositor.renderHidden(renderable, width) : [];
	}

	private visibleLines(
		compositor: TerminalSplitCompositor,
		renderable: any,
		width: number,
	): string[] {
		return this.hiddenLines(compositor, renderable, width).filter(
			(line) => visibleWidth(line) > 0,
		);
	}

	private hideCapturedRenderables(compositor: TerminalSplitCompositor): void {
		if (this.statusContainer?.render)
			compositor.hideRenderable(this.statusContainer);
		if (this.widgetContainerAbove?.render)
			compositor.hideRenderable(this.widgetContainerAbove);
		if (this.editorContainer) compositor.hideRenderable(this.editorContainer);
		if (this.widgetContainerBelow?.render)
			compositor.hideRenderable(this.widgetContainerBelow);
		if (this.footerComponent?.render)
			compositor.hideRenderable(this.footerComponent);
	}

	private clearCapturedRenderables(): void {
		this.compositor = null;
		this.editorContainer = null;
		this.statusContainer = null;
		this.widgetContainerAbove = null;
		this.widgetContainerBelow = null;
		this.footerComponent = null;
	}

	private emergencyResetTerminalMode(): void {
		try {
			process.stdout.write(emergencyTerminalModeReset());
		} catch {
			// Shutdown cleanup cannot surface useful terminal write failures.
		}
	}
}
