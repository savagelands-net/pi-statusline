import { homedir } from "node:os";
import { join } from "node:path";

export const STATUSLINE_CONFIG_DIR_NAME = "savagelands-net-pi-statusline";
export const LEGACY_STATUSLINE_CONFIG_DIR_NAME = "wierd-statusline";

function getHomeDir(): string {
	return process.env.HOME || process.env.USERPROFILE || homedir();
}

export function getStatuslineDataPath(fileName: string): string {
	return join(
		getHomeDir(),
		".pi",
		"agent",
		STATUSLINE_CONFIG_DIR_NAME,
		fileName,
	);
}

export function getLegacyStatuslineDataPath(fileName: string): string {
	return join(
		getHomeDir(),
		".pi",
		"agent",
		LEGACY_STATUSLINE_CONFIG_DIR_NAME,
		fileName,
	);
}
