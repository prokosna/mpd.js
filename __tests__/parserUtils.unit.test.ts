import { normalizeKey, parseLineToKeyValue, parsers } from "../lib/parserUtils";
import type { ParsedTime, ParsedAudio, ParsedRange } from "../lib/types";

describe("MPD Parser Utilities", () => {
	describe("normalizeKey", () => {
		it("should convert various cases to camelCase", () => {
			expect(normalizeKey("SomeKeyName")).toBe("someKeyName"); // PascalCase
			expect(normalizeKey("last-modified")).toBe("lastModified"); // kebab-case
			expect(normalizeKey("audio_output_1_name")).toBe("audioOutput1Name"); // snake_case
			expect(normalizeKey("X-Genre")).toBe("xGenre");
		});

		it("should handle single words", () => {
			expect(normalizeKey("volume")).toBe("volume"); // lowercase
			expect(normalizeKey("Artist")).toBe("artist"); // Uppercase first
		});

		it("should handle already camelCase keys", () => {
			expect(normalizeKey("playlistLength")).toBe("playlistLength");
		});

		it("should handle empty string", () => {
			expect(normalizeKey("")).toBe("");
		});
	});

	describe("parseLineToKeyValue", () => {
		it("should parse a standard key-value line", () => {
			expect(parseLineToKeyValue("Artist: Test Artist")).toEqual([
				"Artist",
				"Test Artist",
			]);
		});

		it("should handle leading/trailing whitespace", () => {
			// Note: The current implementation expects ': ' as separator, so spaces before value matter
			expect(parseLineToKeyValue("  Title:   My Song Title  ")).toEqual([
				"Title",
				"  My Song Title  ",
			]); // Value whitespace preserved
		});

		it("should return undefined for lines without ': ' separator", () => {
			expect(parseLineToKeyValue("random:")).toBeUndefined(); // No space after colon
			expect(parseLineToKeyValue("key value")).toBeUndefined(); // No colon at all
			expect(parseLineToKeyValue("")).toBeUndefined(); // Empty string
		});

		it("should handle lines with value containing colon", () => {
			expect(parseLineToKeyValue("time: 123:456")).toEqual(["time", "123:456"]);
		});
	});

	describe("parsers Object", () => {
		describe("parsers.parseNumber", () => {
			it("should parse valid number strings/numbers", () => {
				expect(parsers.parseNumber("123")).toBe(123);
				expect(parsers.parseNumber("0")).toBe(0);
				expect(parsers.parseNumber("-45")).toBe(-45);
				expect(parsers.parseNumber("123.45")).toBe(123.45);
				expect(parsers.parseNumber(123)).toBe(123);
			});

			it("should return undefined for invalid inputs", () => {
				expect(parsers.parseNumber("abc")).toBeUndefined();
				expect(parsers.parseNumber("")).toBeUndefined();
				expect(parsers.parseNumber(" ")).toBeUndefined();
				expect(parsers.parseNumber(null)).toBeUndefined();
				expect(parsers.parseNumber(undefined)).toBeUndefined();
				expect(parsers.parseNumber("NaN")).toBeUndefined(); // Explicit NaN string results in NaN -> undefined
			});
		});

		describe("parsers.tryParseNumber", () => {
			it("should parse valid number strings/numbers", () => {
				expect(parsers.tryParseNumber("123")).toBe(123);
				expect(parsers.tryParseNumber(123.45)).toBe(123.45);
			});

			it("should return original string for invalid number strings", () => {
				expect(parsers.tryParseNumber("abc")).toBe("abc");
				expect(parsers.tryParseNumber("12a")).toBe("12a");
				expect(parsers.tryParseNumber("NaN")).toBe("NaN");
				expect(parsers.tryParseNumber("Infinity")).toBe(
					Number.POSITIVE_INFINITY,
				); // Special case
				expect(parsers.tryParseNumber("-Infinity")).toBe(
					Number.NEGATIVE_INFINITY,
				); // Special case
			});

			it("should return undefined for non-string/non-number inputs", () => {
				expect(parsers.tryParseNumber(null)).toBeUndefined();
				expect(parsers.tryParseNumber(undefined)).toBeUndefined();
				expect(parsers.tryParseNumber("")).toBeUndefined(); // Empty string likely intended as undefined here
				expect(parsers.tryParseNumber(" ")).toBeUndefined(); // Whitespace string likely intended as undefined
			});
		});

		describe("parsers.parseBoolean", () => {
			it("should parse valid boolean representations", () => {
				expect(parsers.parseBoolean("1")).toBe(true);
				expect(parsers.parseBoolean(1)).toBe(true);
				expect(parsers.parseBoolean("true")).toBe(true);
				expect(parsers.parseBoolean("TRUE")).toBe(true);
				expect(parsers.parseBoolean("on")).toBe(true);
				expect(parsers.parseBoolean("On")).toBe(true);
				expect(parsers.parseBoolean("0")).toBe(false);
				expect(parsers.parseBoolean(0)).toBe(false);
				expect(parsers.parseBoolean("false")).toBe(false);
				expect(parsers.parseBoolean("FALSE")).toBe(false);
				expect(parsers.parseBoolean("off")).toBe(false);
				expect(parsers.parseBoolean("Off")).toBe(false);
				expect(parsers.parseBoolean(true)).toBe(true);
				expect(parsers.parseBoolean(false)).toBe(false);
			});

			it("should return undefined for invalid inputs", () => {
				expect(parsers.parseBoolean("yes")).toBeUndefined();
				expect(parsers.parseBoolean("no")).toBeUndefined();
				expect(parsers.parseBoolean(2)).toBeUndefined();
				expect(parsers.parseBoolean("")).toBeUndefined();
				expect(parsers.parseBoolean(null)).toBeUndefined();
				expect(parsers.parseBoolean(undefined)).toBeUndefined();
			});
		});

		describe("parsers.parseSingle", () => {
			it("should parse valid single values", () => {
				expect(parsers.parseSingle("1")).toBe("1");
				expect(parsers.parseSingle("0")).toBe("0");
				expect(parsers.parseSingle("oneshot")).toBe("oneshot");
				expect(parsers.parseSingle("ONESHOT")).toBe("oneshot");
				expect(parsers.parseSingle(1)).toBe("1");
				expect(parsers.parseSingle(0)).toBe("0");
				expect(parsers.parseSingle(true)).toBe("1");
				expect(parsers.parseSingle(false)).toBe("0");
			});

			it("should return undefined for invalid values", () => {
				expect(parsers.parseSingle("2")).toBeUndefined();
				expect(parsers.parseSingle("")).toBeUndefined();
				expect(parsers.parseSingle(null)).toBeUndefined();
			});
		});

		describe("parsers.parseTime", () => {
			it("should parse valid 'elapsed:total' strings", () => {
				expect(parsers.parseTime("123:456")).toEqual<ParsedTime>({
					elapsed: 123,
					total: 456,
				});
				expect(parsers.parseTime("0:10")).toEqual<ParsedTime>({
					elapsed: 0,
					total: 10,
				});
				expect(parsers.parseTime("10.5:60.2")).toEqual<ParsedTime>({
					elapsed: 10.5,
					total: 60.2,
				});
			});

			it("should parse valid 'total' strings", () => {
				expect(parsers.parseTime("456")).toEqual<ParsedTime>({
					elapsed: undefined,
					total: 456,
				});
			});

			it("should return undefined for invalid formats", () => {
				expect(parsers.parseTime("123:")).toBeUndefined(); // Missing total
				expect(parsers.parseTime(":456")).toBeUndefined(); // Missing elapsed
				expect(parsers.parseTime("abc:def")).toBeUndefined();
				expect(parsers.parseTime("123:abc")).toBeUndefined();
				expect(parsers.parseTime("123:456:789")).toBeUndefined();
				expect(parsers.parseTime("")).toBeUndefined();
				expect(parsers.parseTime(null)).toBeUndefined();
				expect(parsers.parseTime(123)).toBeUndefined(); // Expects string
			});
		});

		describe("parsers.parseState", () => {
			it("should parse valid states", () => {
				expect(parsers.parseState("play")).toBe("play");
				expect(parsers.parseState("stop")).toBe("stop");
				expect(parsers.parseState("pause")).toBe("pause");
				expect(parsers.parseState(" Play ")).toBe("play"); // Handles whitespace
				expect(parsers.parseState("STOP")).toBe("stop"); // Handles case
			});

			it("should return undefined for invalid states", () => {
				expect(parsers.parseState("playing")).toBeUndefined();
				expect(parsers.parseState("")).toBeUndefined();
				expect(parsers.parseState(null)).toBeUndefined();
			});
		});

		describe("parsers.tryParseRange", () => {
			it("should parse valid range strings (START-END)", () => {
				expect(parsers.tryParseRange("0-100")).toEqual<ParsedRange>({
					start: 0,
					end: 100,
				});
				expect(parsers.tryParseRange("50-50")).toEqual<ParsedRange>({
					start: 50,
					end: 50,
				});
				expect(parsers.tryParseRange("-10-10")).toEqual<ParsedRange>({
					start: -10,
					end: 10,
				});
				expect(parsers.tryParseRange("60.5-120.1")).toEqual<ParsedRange>({
					start: 60.5,
					end: 120.1,
				});
			});

			it("should parse valid open-ended range strings (START-)", () => {
				expect(parsers.tryParseRange("180-")).toEqual<ParsedRange>({
					start: 180,
				});
				expect(parsers.tryParseRange("0-")).toEqual<ParsedRange>({ start: 0 });
				expect(parsers.tryParseRange("-10-")).toEqual<ParsedRange>({
					start: -10,
				});
				expect(parsers.tryParseRange("60.5-")).toEqual<ParsedRange>({
					start: 60.5,
				});
			});

			it("should return original string for invalid range formats", () => {
				expect(parsers.tryParseRange("0")).toBe("0"); // Missing '-'
				expect(parsers.tryParseRange("-100")).toBe("-100"); // Missing '-', treated as single number string
				expect(parsers.tryParseRange("--")).toBe("--"); // Missing numbers
				expect(parsers.tryParseRange("abc-def")).toBe("abc-def");
				expect(parsers.tryParseRange("10-abc")).toBe("10-abc");
				expect(parsers.tryParseRange("abc-10")).toBe("abc-10");
				expect(parsers.tryParseRange("10-5")).toBe("10-5"); // Invalid range (start > end)
				expect(parsers.tryParseRange("10--20")).toBe("10--20"); // Double hyphen
			});

			it("should return undefined for non-string input", () => {
				expect(parsers.tryParseRange(null)).toBeUndefined();
			});
		});

		describe("parsers.tryParseAudio", () => {
			const expectedAudio = (
				orig: string,
				rate: number | string | undefined,
				bits: number | string | undefined,
				chans: number | string | undefined,
			): Partial<ParsedAudio> | string | undefined => {
				if (typeof rate !== "number" || typeof chans !== "number") return orig;
				const short = parsers.toShortUnit(rate);
				return {
					originalValue: orig,
					sampleRate: rate,
					bits: bits,
					channels: chans,
					sampleRateShort: { value: short.value, unit: `${short.unit}Hz` },
				};
			};

			it("should parse valid audio strings", () => {
				expect(parsers.tryParseAudio("44100:16:2")).toMatchObject(
					expectedAudio("44100:16:2", 44100, 16, 2) as object,
				);
				expect(parsers.tryParseAudio("48000:24:2")).toMatchObject(
					expectedAudio("48000:24:2", 48000, 24, 2) as object,
				);
				expect(parsers.tryParseAudio("*:f:1")).toBe("*:f:1"); // Invalid bits/channels returns string
				expect(parsers.tryParseAudio("44100:*:2")).toMatchObject(
					expectedAudio("44100:*:2", 44100, "*", 2) as object,
				);
			});

			it("should return original string for invalid formats", () => {
				expect(parsers.tryParseAudio("44100:16")).toBe("44100:16");
				expect(parsers.tryParseAudio("abc:def:ghi")).toBe("abc:def:ghi");
				expect(parsers.tryParseAudio("")).toBeUndefined(); // Empty string is undefined
			});

			it("should return undefined for non-string input", () => {
				expect(parsers.tryParseAudio(123)).toBeUndefined();
				expect(parsers.tryParseAudio(null)).toBeUndefined();
			});

			it("should calculate sampleRateShort correctly", () => {
				const result = parsers.tryParseAudio("44100:16:2") as ParsedAudio;
				expect(result.sampleRateShort).toEqual({ value: 44.1, unit: "kHz" });
				const result2 = parsers.tryParseAudio("8000:8:1") as ParsedAudio;
				expect(result2.sampleRateShort).toEqual({ value: 8, unit: "kHz" });
				const result3 = parsers.tryParseAudio("96000:24:6") as ParsedAudio;
				expect(result3.sampleRateShort).toEqual({ value: 96, unit: "kHz" });
				const result4 = parsers.tryParseAudio("192000:24:6") as ParsedAudio;
				expect(result4.sampleRateShort).toEqual({ value: 192, unit: "kHz" });
			});
		});

		describe("parsers.tryParseDate", () => {
			it("should parse valid ISO date strings", () => {
				const dateStr = "2023-10-27T10:00:00Z";
				const expectedDate = new Date(dateStr);
				expect(parsers.tryParseDate(dateStr)).toEqual(expectedDate);
			});

			it("should return original string for invalid date strings", () => {
				expect(parsers.tryParseDate("invalid date")).toBe("invalid date");
				expect(parsers.tryParseDate("2023-13-01T00:00:00Z")).toBe(
					"2023-13-01T00:00:00Z",
				); // Invalid month
			});

			it("should return undefined for non-string input", () => {
				expect(parsers.tryParseDate(null)).toBeUndefined();
				expect(parsers.tryParseDate(1234567890)).toBeUndefined();
			});
		});

		describe("parsers.toShortUnit", () => {
			it("should convert numbers to short units correctly", () => {
				expect(parsers.toShortUnit(1000)).toEqual({ value: 1, unit: "k" });
				expect(parsers.toShortUnit(1500)).toEqual({ value: 1.5, unit: "k" });
				expect(parsers.toShortUnit(1000000)).toEqual({ value: 1, unit: "M" });
				expect(parsers.toShortUnit(1234567)).toEqual({
					value: 1.234567,
					unit: "M",
				});
				expect(parsers.toShortUnit(500)).toEqual({ value: 500, unit: "" });
				expect(parsers.toShortUnit(0)).toEqual({ value: 0, unit: "" });
			});

			it("should respect digits parameter", () => {
				expect(parsers.toShortUnit(1234, 1)).toEqual({ value: 1.2, unit: "k" });
				expect(parsers.toShortUnit(1234567, 2)).toEqual({
					value: 1.23,
					unit: "M",
				});
			});
		});
	});
});
