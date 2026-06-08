import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { TUI } from "@earendil-works/pi-tui";

import { shortenModelName } from "./blocks.ts";
import {
	createTokenRateTracker,
	tokenDeltaTextFromEvent,
	type TokenRateSnapshot,
} from "./token-rate.ts";

interface TokenRateCoordinatorArgs {
	pi: ExtensionAPI;
	getStatuslineEnabled: () => boolean;
	getActiveTui: () => TUI | undefined;
}

export class TokenRateCoordinator {
	private readonly tracker = createTokenRateTracker();
	private nextRenderAt = 0;

	constructor(private readonly args: TokenRateCoordinatorArgs) {
		this.registerEvents();
	}

	getSnapshot(): TokenRateSnapshot | null {
		const snapshot = this.tracker.getSnapshot();
		return snapshot?.model ? snapshot : null;
	}

	reset(): void {
		this.tracker.reset();
		this.requestRender(true);
	}

	stopActive(): void {
		if (this.tracker.stopActive()) this.requestRender(true);
	}

	private requestRender(force = false): void {
		if (!this.args.getStatuslineEnabled()) return;
		const now = Date.now();
		if (!force && now < this.nextRenderAt) return;
		this.nextRenderAt = now + 250;
		this.args.getActiveTui()?.requestRender();
	}

	private registerEvents(): void {
		this.args.pi.on("model_select", () => this.handleModelSelect());
		this.args.pi.on("message_start", (event, ctx) => {
			if (event.message.role !== "assistant") return;
			this.tracker.start(shortenModelName(ctx.model));
			this.requestRender(true);
		});
		this.args.pi.on("message_update", (event) => {
			const delta = tokenDeltaTextFromEvent(event.assistantMessageEvent);
			if (delta === null) return;
			if (this.tracker.recordDelta(delta)) this.requestRender();
		});
		this.args.pi.on("message_end", (event) => {
			if (event.message.role !== "assistant") return;
			const msg = event.message as AssistantMessage;
			const usageOutput =
				typeof msg.usage?.output === "number" ? msg.usage.output : undefined;
			if (this.tracker.finish(usageOutput)) this.requestRender(true);
		});
	}

	private handleModelSelect(): void {
		if (this.tracker.getSnapshot()?.active) return;
		this.tracker.reset();
		this.requestRender(true);
	}
}
