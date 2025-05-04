import { describe, it } from "vitest";
import { expect } from "vitest";
import {
	Parsers,
	type ListParserOptions,
	type ObjectParsingOptions,
} from "../lib/parsers";
import type { ResponseLine } from "../lib/types";
import { ReadableStream } from "node:stream/web";
import type { TransformStream } from "node:stream/web";

// Helper function revised to manually handle TransformStream
async function testStreamTransformerManual<TInput, TOutput>(
	createTransformer: () => TransformStream<TInput, TOutput>,
	input: TInput[],
): Promise<TOutput[]> {
	const transformer = createTransformer();
	const output: TOutput[] = [];
	const reader = transformer.readable.getReader();
	const writer = transformer.writable.getWriter();

	const readPromise = (async () => {
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				output.push(value);
			}
		} finally {
		}
	})();

	const writePromise = (async () => {
		try {
			for (const item of input) {
				await writer.write(item);
			}
			await writer.close();
		} catch (e) {
			await reader.cancel(e);
			throw e;
		}
	})();

	try {
		await Promise.all([readPromise, writePromise]);
	} catch (e) {
		console.error("Error during stream processing in test helper:", e);
	}

	return output;
}

const rl = (line: string): ResponseLine => ({ raw: line });

describe("MpdParsers", () => {
	describe("aggregateToString", () => {
		it("should aggregate stream chunks into a single string", async () => {
			const input = [rl("line1"), rl("line2"), rl("OK")];
			const stream = new ReadableStream<ResponseLine>({
				start(controller) {
					for (const item of input) {
						controller.enqueue(item);
					}
					controller.close();
				},
			});
			const result = await Parsers.aggregateToString(stream);
			expect(result).toBe("line1\nline2\nOK");
		});

		it("should return an empty string for an empty stream", async () => {
			const stream = new ReadableStream<ResponseLine>({
				start(controller) {
					controller.close();
				},
			});
			const result = await Parsers.aggregateToString(stream);
			expect(result).toBe("");
		});
	});

	describe("transformToList", () => {
		it("should parse lines into a list of objects based on delimiter", async () => {
			const input = [
				rl("file: track1.mp3"),
				rl("Title: Track 1"),
				rl("Artist: Artist A"),
				rl("file: track2.ogg"),
				rl("Title: Track 2"),
				rl("Artist: Artist B"),
				rl("OK"),
			];
			const options: ListParserOptions = { delimiterKeys: ["file"] };
			const result = await testStreamTransformerManual(
				() => Parsers.transformToList(options),
				input,
			);

			expect(result).toEqual([
				{ file: "track1.mp3", title: "Track 1", artist: "Artist A" },
				{ file: "track2.ogg", title: "Track 2", artist: "Artist B" },
			]);
		});

		it("should handle normalization", async () => {
			const input = [
				rl("file: track1.mp3"),
				rl("Last-Modified: 2024-01-01T00:00:00Z"),
				rl("file: track2.ogg"),
				rl("Last-Modified: 2024-02-01T00:00:00Z"),
				rl("OK"),
			];
			const options: ListParserOptions = {
				delimiterKeys: ["file"],
				normalizeKeys: true,
			};
			const result = await testStreamTransformerManual(
				() => Parsers.transformToList(options),
				input,
			);

			expect(result).toEqual([
				{ file: "track1.mp3", lastModified: "2024-01-01T00:00:00Z" },
				{ file: "track2.ogg", lastModified: "2024-02-01T00:00:00Z" },
			]);
		});

		it("should return an empty array for empty input", async () => {
			const input = [rl("OK")];
			const options: ListParserOptions = { delimiterKeys: ["file"] };
			const result = await testStreamTransformerManual(
				() => Parsers.transformToList(options),
				input,
			);
			expect(result).toEqual([]);
		});
	});

	describe("transformToListAndAccumulate", () => {
		it("should parse lines into a nested list of objects", async () => {
			const input = [
				rl("directory: Music"),
				rl("Last-Modified: 2024-01-01T00:00:00Z"),
				rl("file: Music/song1.mp3"),
				rl("Title: Song 1"),
				rl("Artist: Artist X"),
				rl("file: Music/song2.ogg"),
				rl("Title: Song 2"),
				rl("directory: Podcasts"),
				rl("Last-Modified: 2024-02-01T00:00:00Z"),
				rl("file: Podcasts/episode1.mp3"),
				rl("Title: Episode 1"),
				rl("OK"),
			];
			const options: ListParserOptions = {
				delimiterKeys: ["directory", "file"],
				normalizeKeys: true,
			};
			const result = await testStreamTransformerManual(
				() => Parsers.transformToListAndAccumulate(options),
				input,
			);

			expect(result).toEqual([
				{
					directory: "Music",
					lastModified: "2024-01-01T00:00:00Z",
					children: [
						{ file: "Music/song1.mp3", title: "Song 1", artist: "Artist X" },
						{ file: "Music/song2.ogg", title: "Song 2" },
					],
				},
				{
					directory: "Podcasts",
					lastModified: "2024-02-01T00:00:00Z",
					children: [{ file: "Podcasts/episode1.mp3", title: "Episode 1" }],
				},
			]);
		});

		it("should handle properties appearing before the first delimiter", async () => {
			const input = [
				rl("Some-Property: SomeValue"),
				rl("directory: Music"),
				rl("Last-Modified: 2024-01-01T00:00:00Z"),
				rl("file: Music/song1.mp3"),
				rl("Title: Song 1"),
				rl("OK"),
			];
			const options: ListParserOptions = {
				delimiterKeys: ["directory", "file"],
				normalizeKeys: true,
			};
			const result = await testStreamTransformerManual(
				() => Parsers.transformToListAndAccumulate(options),
				input,
			);

			expect(result).toEqual([
				{
					directory: "Music",
					lastModified: "2024-01-01T00:00:00Z",
					children: [{ file: "Music/song1.mp3", title: "Song 1" }],
				},
			]);
		});

		it("should parse lines into a nested list of objects if a child delimiter key appears before the first top-level delimiter", async () => {
			const input = [
				rl("file: song1.mp3"),
				rl("Title: Song 1"),
				rl("Artist: Artist X"),
				rl("file: song2.ogg"),
				rl("Title: Song 2"),
				rl("directory: Music"),
				rl("Last-Modified: 2024-01-01T00:00:00Z"),
				rl("file: Music/song1.mp3"),
				rl("Title: Song 1"),
				rl("Artist: Artist X"),
				rl("file: Music/song2.ogg"),
				rl("Title: Song 2"),
				rl("directory: Podcasts"),
				rl("Last-Modified: 2024-02-01T00:00:00Z"),
				rl("file: Podcasts/episode1.mp3"),
				rl("Title: Episode 1"),
				rl("OK"),
			];
			const options: ListParserOptions = {
				delimiterKeys: ["directory", "file"],
				normalizeKeys: true,
			};
			const result = await testStreamTransformerManual(
				() => Parsers.transformToListAndAccumulate(options),
				input,
			);

			expect(result).toEqual([
				{ file: "song1.mp3", title: "Song 1", artist: "Artist X" },
				{ file: "song2.ogg", title: "Song 2" },
				{
					directory: "Music",
					lastModified: "2024-01-01T00:00:00Z",
					children: [
						{ file: "Music/song1.mp3", title: "Song 1", artist: "Artist X" },
						{ file: "Music/song2.ogg", title: "Song 2" },
					],
				},
				{
					directory: "Podcasts",
					lastModified: "2024-02-01T00:00:00Z",
					children: [{ file: "Podcasts/episode1.mp3", title: "Episode 1" }],
				},
			]);
		});

		it("should return an empty array for empty input", async () => {
			const input = [rl("OK")];
			const options: ListParserOptions = {
				delimiterKeys: ["directory", "file"],
			};
			const result = await testStreamTransformerManual(
				() => Parsers.transformToListAndAccumulate(options),
				input,
			);
			expect(result).toEqual([]);
		});
	});

	describe("transformToObject", () => {
		it("should parse lines into a single object", async () => {
			const input = [
				rl("volume: 50"),
				rl("repeat: 0"),
				rl("state: play"),
				rl("OK"),
			];
			const options: ObjectParsingOptions = {};
			const result = await testStreamTransformerManual(
				() => Parsers.transformToObject(options),
				input,
			);

			expect(result.length).toBe(1);
			expect(result[0]).toEqual({
				volume: "50",
				repeat: "0",
				state: "play",
			});
		});

		it("should handle normalization", async () => {
			const input = [
				rl("playlistlength: 10"),
				rl("mixrampdb: 0.000000"),
				rl("OK"),
			];
			const options: ObjectParsingOptions = { normalizeKeys: true };
			const result = await testStreamTransformerManual(
				() => Parsers.transformToObject(options),
				input,
			);

			expect(result.length).toBe(1);
			expect(result[0]).toEqual({
				playlistlength: "10",
				mixrampdb: "0.000000",
			});
		});

		it("should return an empty array for empty input", async () => {
			const input = [rl("OK")];
			const options: ObjectParsingOptions = {};
			const result = await testStreamTransformerManual(
				() => Parsers.transformToObject(options),
				input,
			);
			expect(result.length).toBe(0);
		});
	});
});
