import type {
	ParsedTime,
	ParsedAudio,
	TypedMpdObject,
	ParsedRange,
	ResponseLine,
} from "./types";
import debugCreator from "debug";
import { PACKAGE_NAME } from "./const";

const debug = debugCreator(`${PACKAGE_NAME}:parserUtils`);

export const isString = (val: unknown): val is string =>
	typeof val === "string";

export const isNumber = (val: unknown): val is number =>
	typeof val === "number";

export const isNonEmptyString = (val: unknown): boolean =>
	isString(val) && !!val.trim().length;

export function escapeArg(arg: unknown): string {
	const escaped = `${arg}`.replace(/"/g, '\\"');
	return `"${escaped}"`;
}

/**
 * Parses a raw MPD line into a key-value pair.
 * Returns undefined if the line doesn't contain a colon.
 * Example: "volume: 100" -> ["volume", "100"]
 */
export function parseLineToKeyValue(
	line: string,
): [string, string] | undefined {
	const idx = line.indexOf(": ");
	if (idx === -1) {
		return undefined; // Not a valid key-value line
	}
	const key = line.substring(0, idx).trim(); // Trim whitespace from key
	const val = line.substring(idx + 2);
	return [key, val];
}

/** Normalizes MPD keys (e.g., "Last-Modified" -> "lastModified"). */
export const normalizeKey = (key: string): string => {
	// Convert to camelCase: foo-bar -> fooBar, FooBar -> fooBar, foo_bar -> fooBar
	return key
		.replace(/([-_][a-zA-Z0-9])/g, (group) =>
			group.toUpperCase().replace("-", "").replace("_", ""),
		)
		.replace(/^[A-Z]/, (match) => match.toLowerCase());
};

export const parsers = {
	parseNumber: (num: unknown): number | undefined => {
		if (num === null || num === undefined) return undefined;
		if (isNumber(num)) return num;
		if (!isString(num)) return undefined;
		if (num.trim() === "") return undefined;

		const val = Number(num);
		return Number.isNaN(val) ? undefined : val;
	},

	tryParseNumber: (num: unknown): number | string | undefined => {
		if (num === null || num === undefined) return undefined;
		if (isNumber(num)) return num;
		if (!isString(num)) return undefined;
		if (num.trim() === "") return undefined;

		const val = Number(num);
		return Number.isNaN(val) ? String(num) : val;
	},

	parseBoolean: (val: unknown): boolean | undefined => {
		if (typeof val === "boolean") return val;
		if (val === 1) return true;
		if (val === 0) return false;
		if (isString(val)) {
			const lowerVal = val.toLowerCase().trim();
			if (lowerVal === "true" || lowerVal === "1" || lowerVal === "on")
				return true;
			if (lowerVal === "false" || lowerVal === "0" || lowerVal === "off")
				return false;
		}
		return undefined;
	},

	parseSingle: (val: unknown): "0" | "1" | "oneshot" | undefined => {
		if (isString(val) && val.toLowerCase() === "oneshot") {
			return "oneshot";
		}
		const bool = parsers.parseBoolean(val);
		if (bool === undefined) return undefined;
		return bool ? "1" : "0";
	},

	parseTime: (val: unknown): ParsedTime | undefined => {
		if (!isString(val)) return undefined;

		const parts = val.split(":");
		if (parts.length === 1) {
			const total = parsers.parseNumber(parts[0]);
			return total !== undefined ? { elapsed: undefined, total } : undefined;
		}
		if (parts.length === 2) {
			const elapsed = parsers.parseNumber(parts[0]);
			const total = parsers.parseNumber(parts[1]);
			if (elapsed !== undefined && total !== undefined) {
				return { elapsed, total };
			}
		}
		return undefined;
	},

	parseState: (val: unknown): "play" | "stop" | "pause" | undefined => {
		if (!isString(val)) return undefined;
		const lowerVal = val.toLowerCase().trim();
		if (lowerVal === "play" || lowerVal === "stop" || lowerVal === "pause") {
			return lowerVal;
		}
		return undefined;
	},

	tryParseRange: (val: unknown): ParsedRange | string | undefined => {
		if (!isString(val)) return undefined;

		const parts = val.split("-");

		// Case 1: START-END (e.g., "60-120", "60.5-120.1")
		if (parts.length === 2 && parts[0] !== "" && parts[1] !== "") {
			const start = parsers.parseNumber(parts[0]);
			const end = parsers.parseNumber(parts[1]);
			if (start !== undefined && end !== undefined && start <= end) {
				return { start, end };
			}
		}

		// Case 2: START- (e.g., "180-", "180.5-")
		if (parts.length === 2 && parts[0] !== "" && parts[1] === "") {
			const start = parsers.parseNumber(parts[0]);
			if (start !== undefined) {
				return { start }; // end is implicitly undefined
			}
		}

		// Case 3: -START-END (e.g., "-10-20") - Handles negative start
		if (
			parts.length === 3 &&
			parts[0] === "" &&
			parts[1] !== "" &&
			parts[2] !== ""
		) {
			const start = parsers.parseNumber(`-${parts[1]}`);
			const end = parsers.parseNumber(parts[2]);
			if (start !== undefined && end !== undefined && start <= end) {
				return { start, end };
			}
		}

		// Case 4: -START- (e.g., "-10-") - Handles negative start, open-ended
		if (
			parts.length === 3 &&
			parts[0] === "" &&
			parts[1] !== "" &&
			parts[2] === ""
		) {
			const start = parsers.parseNumber(`-${parts[1]}`);
			if (start !== undefined) {
				return { start };
			}
		}

		return val;
	},

	tryParseAudio: (val: unknown): ParsedAudio | string | undefined => {
		if (!isString(val)) return undefined;
		if (val === "") return undefined;

		const parts = val.split(":");
		if (parts.length !== 3) {
			debug(`Invalid audio format string: ${val}`);
			return val;
		}

		const sampleRate = parsers.tryParseNumber(parts[0]);
		const bits = parsers.tryParseNumber(parts[1]);
		const channels = parsers.tryParseNumber(parts[2]);

		if (!isNumber(sampleRate) || !isNumber(channels)) {
			debug(`Could not parse sample rate or channels as numbers from: ${val}`);
			return val;
		}

		const sampleRateShort = parsers.toShortUnit(sampleRate);
		sampleRateShort.unit += "Hz";

		return {
			originalValue: val,
			sampleRate,
			bits,
			channels,
			sampleRateShort,
		};
	},

	tryParseDate: (val: unknown): Date | string | undefined => {
		if (!isString(val)) return undefined;

		const date = new Date(val);
		return !Number.isNaN(date.getTime()) ? date : val;
	},

	toShortUnit: (
		num: number,
		digits?: number,
	): { value: number; unit: string } => {
		const effectiveDigits = isNumber(digits) ? digits : `${num}`.length;

		const si = [
			{ value: 1, symbol: "" },
			{ value: 1e3, symbol: "k" },
			{ value: 1e6, symbol: "M" },
			{ value: 1e9, symbol: "G" },
			{ value: 1e12, symbol: "T" },
			{ value: 1e15, symbol: "P" },
			{ value: 1e18, symbol: "E" },
		];
		const rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
		let ii: number;
		for (ii = si.length - 1; ii > 0; ii--) {
			if (num >= si[ii].value) {
				break;
			}
		}
		const parsedValue = parsers.parseNumber(
			(num / si[ii].value).toFixed(effectiveDigits).replace(rx, "$1"),
		);
		return {
			value: parsedValue !== undefined ? parsedValue : 0,
			unit: si[ii].symbol,
		};
	},
};

// Map known MPD keys to their respective parser functions
// Keys should be the camelCase version generated by normalizeKey
export const fieldParsers: {
	[K in keyof TypedMpdObject]?: (val: unknown) => TypedMpdObject[K];
} = {
	// Base
	size: parsers.parseNumber,

	// Tags
	track: parsers.tryParseNumber,
	showmovement: parsers.parseBoolean,
	disc: parsers.tryParseNumber,

	// Other metadata
	duration: parsers.parseNumber,
	time: parsers.parseTime,
	range: parsers.tryParseRange,
	format: parsers.tryParseAudio,
	lastModified: parsers.tryParseDate,
	added: parsers.tryParseDate,

	// Status
	volume: parsers.parseNumber,
	repeat: parsers.parseBoolean,
	random: parsers.parseBoolean,
	single: parsers.parseSingle,
	consume: parsers.parseBoolean,
	playlist: parsers.tryParseNumber,
	playlistlength: parsers.parseNumber,
	state: parsers.parseState,
	song: parsers.parseNumber,
	songid: parsers.parseNumber,
	nextsong: parsers.parseNumber,
	nextsongid: parsers.parseNumber,
	elapsed: parsers.parseNumber,
	bitrate: parsers.parseNumber,
	xfade: parsers.parseNumber,
	mixrampdb: parsers.parseNumber,
	mixrampdelay: parsers.parseNumber,
	audio: parsers.tryParseAudio,
	updatingDb: parsers.parseNumber,

	// Stats
	artists: parsers.parseNumber,
	albums: parsers.parseNumber,
	songs: parsers.parseNumber,
	uptime: parsers.parseNumber,
	dbPlaytime: parsers.parseNumber,
	dbUpdate: parsers.parseNumber,
	playtime: parsers.parseNumber,

	// Queue
	id: parsers.parseNumber,
	pos: parsers.parseNumber,
	prio: parsers.parseNumber,

	// Outputs
	outputid: parsers.tryParseNumber,
	outputenabled: parsers.parseBoolean,
};

// Helper function to add or merge values into an object,
// handling array creation for duplicate keys.
function addOrMerge(
	targetObj: Record<string, unknown>,
	key: string,
	value: unknown,
) {
	if (!(key in targetObj)) {
		targetObj[key] = value;
	} else {
		if (!Array.isArray(targetObj[key])) {
			targetObj[key] = [targetObj[key]];
		}
		(targetObj[key] as unknown[]).push(value);
	}
}

class LineTransformer {
	protected delimiterKeys: string[];
	protected normalizeKeys: boolean;
	protected currentItem: Record<string, unknown> | undefined = undefined;

	constructor(delimiterKeys?: string[] | string, normalizeKeys?: boolean) {
		this.delimiterKeys = (
			Array.isArray(delimiterKeys)
				? delimiterKeys
				: delimiterKeys !== undefined
					? [delimiterKeys]
					: []
		).map(normalizeKey);
		this.normalizeKeys = normalizeKeys ?? true;
	}
}

export class LineToListTransformer extends LineTransformer {
	private isFirstLine = true;

	transform(
		line: ResponseLine,
		onReady: (item: Record<string, unknown>) => void,
	) {
		const kvPair = parseLineToKeyValue(line.raw);
		if (!kvPair) {
			return;
		}
		const [rawKey, rawValue] = kvPair;
		const key = normalizeKey(rawKey);
		const value = rawKey === "binary" ? line.binaryData : rawValue;

		if (this.isFirstLine && this.delimiterKeys.length === 0) {
			this.delimiterKeys.push(key);
			this.isFirstLine = false;
		}

		if (this.delimiterKeys.includes(key)) {
			if (
				this.currentItem !== undefined &&
				Object.keys(this.currentItem).length > 0
			) {
				onReady(this.currentItem);
			}
			this.currentItem = {};
			addOrMerge(this.currentItem, this.normalizeKeys ? key : rawKey, value);
		} else {
			addOrMerge(this.currentItem, this.normalizeKeys ? key : rawKey, value);
		}
	}

	flush(onReady: (item: Record<string, unknown>) => void) {
		if (
			this.currentItem !== undefined &&
			Object.keys(this.currentItem).length > 0
		) {
			onReady(this.currentItem);
		}
	}
}

export class LineToListAndAccumulateTransformer extends LineTransformer {
	private currentPath: Record<string, unknown>[] = [];

	constructor(delimiterKeys?: string[] | string, normalizeKeys?: boolean) {
		super(delimiterKeys, normalizeKeys);
		if (this.delimiterKeys.length < 1) {
			throw new Error(
				"At least one delimiter key is required for accumulation",
			);
		}
	}

	transform(
		line: ResponseLine,
		onReady: (item: Record<string, unknown>) => void,
	) {
		const kvPair = parseLineToKeyValue(line.raw);
		if (!kvPair) {
			return;
		}
		const [rawKey, rawValue] = kvPair;
		const value = rawKey === "binary" ? line.binaryData : rawValue;
		const key = normalizeKey(rawKey);

		const level = this.delimiterKeys.indexOf(key);

		if (level === 0) {
			// --- Top level entity ---
			if (this.currentItem !== undefined) {
				onReady(this.currentItem);
				this.currentItem = undefined;
			}
			// Emit the previously completed nested top-level item if it exists
			const previousTopLevel = this.currentPath[0];
			if (previousTopLevel && Object.keys(previousTopLevel).length > 0) {
				onReady(previousTopLevel);
			}
			// Start new top-level item
			const newItem = {};
			addOrMerge(newItem, this.normalizeKeys ? key : rawKey, value);
			this.currentPath = [newItem];
		} else if (level > 0) {
			if (this.currentPath.length === 0) {
				// --- Standalone item (before first top-level) ---
				// Emit previous standalone item if exists
				if (this.currentItem !== undefined) {
					onReady(this.currentItem);
				}
				// Start new standalone item
				const newItem = {};
				addOrMerge(newItem, this.normalizeKeys ? key : rawKey, value);
				this.currentItem = newItem;
			} else {
				// --- Nested entity (inside a top-level) ---
				if (level > this.currentPath.length) {
					throw new Error(
						`Invalid nesting level: Key '${key}' at level ${level} found, but current path depth is ${this.currentPath.length}`,
					);
				}
				const parent = this.currentPath[level - 1];
				if (!parent) {
					throw new Error(
						`Error finding parent for key '${key}' at level ${level}`,
					);
				}
				if (!Array.isArray(parent.children)) {
					parent.children = [];
				}
				const newItem = {};
				addOrMerge(newItem, this.normalizeKeys ? key : rawKey, value);
				if (Array.isArray(parent.children)) {
					parent.children.push(newItem);
				} else {
					throw new Error("This should never happen");
				}
				this.currentPath[level] = newItem;
				this.currentPath.length = level + 1;
			}
		} else {
			// --- Regular property ---
			const target =
				this.currentPath.length > 0
					? this.currentPath.at(-1)
					: this.currentItem;
			if (target) {
				addOrMerge(target, this.normalizeKeys ? key : rawKey, value);
			} else {
				debug(
					`Ignoring property '${key}': No current object context established yet.`,
				);
			}
		}
	}

	flush(onReady: (item: Record<string, unknown>) => void) {
		// Emit the last nested top-level item when the stream ends
		const lastTopLevel = this.currentPath[0];
		if (lastTopLevel && Object.keys(lastTopLevel).length > 0) {
			onReady(lastTopLevel);
		}
		// Emit the last standalone item if it exists
		if (this.currentItem) {
			onReady(this.currentItem);
		}
		// Clear state
		this.currentPath = [];
		this.currentItem = undefined;
	}
}
