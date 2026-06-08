import { describe, expect, it } from "vitest";

import { TerminalSplitCompositor } from "./terminal-split.ts";

function makeTerminal() {
	const writes: string[] = [];
	return {
		writes,
		terminal: {
			columns: 80,
			rows: 24,
			write(data: string) {
				writes.push(data);
			},
		},
	};
}

function makeTui() {
	return {
		children: [],
		render: () => ["old transcript"],
		doRender() {},
		requestRender() {},
		addInputListener() {
			return () => {};
		},
	};
}

describe("TerminalSplitCompositor teardown", () => {
	it("clears the fixed-editor alternate-screen contents before exiting", () => {
		const { terminal, writes } = makeTerminal();
		const compositor = new TerminalSplitCompositor({
			tui: makeTui(),
			terminal,
			renderCluster: () => ({
				lines: ["status", "editor"],
				cursor: null,
			}),
		});

		compositor.install();
		compositor.dispose({ resetExtendedKeyboardModes: true });

		const restoreWrite = writes.at(-1) ?? "";
		expect(restoreWrite).toContain("\x1b[2J");
		expect(restoreWrite).toContain("\x1b[H");
		expect(restoreWrite.indexOf("\x1b[2J")).toBeLessThan(
			restoreWrite.indexOf("\x1b[?1049l"),
		);
	});
});
