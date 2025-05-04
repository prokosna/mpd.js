import type { Buffer } from "node:buffer";
import type { ResponseLine, MpdTypedObject } from "./types.js";
import { TransformStream } from "node:stream/web";
import type { ReadableStream } from "node:stream/web";
import {
	normalizeKey,
	parseLineToKeyValue,
	fieldParsers,
	LineToListTransformer,
	LineToListAndAccumulateTransformer,
} from "./parserUtils.js";

/**
 * Common options for parsing MPD responses into objects.
 */
export interface ObjectParsingOptions {
	/**
	 * Whether to normalize keys (e.g., "Last-Modified" to "lastModified").
	 * Defaults to true if not specified.
	 */
	normalizeKeys?: boolean;
}

/**
 * Options specific to parsing lists of objects from MPD responses,
 * extending common object parsing options.
 */
export interface ListParserOptions extends ObjectParsingOptions {
	/**
	 * The key(s) that indicate the start of a new object within a list response.
	 * For example, 'file' for `listallinfo` or 'directory'/'playlist'/'file' for `lsinfo`.
	 * If not provided, the parser uses the first key in the response as the delimiter.
	 * Can be a single string or an array of strings.
	 */
	delimiterKeys?: string[] | string;
}

/**
 * Provides a collection of stream transformers and aggregators
 * for parsing various MPD response formats.
 * These are designed to be piped together or used with ReadableStream methods
 * to process the raw `ResponseLine` stream from the MPD connection.
 *
 * @example Basic Usage with `status` command (single object)
 * ```typescript
 * const statusStream = await client.sendCommand('status');
 * const statusObject = await statusStream
 *   .pipeThrough(MpdParsers.transformToObject())
 *   .pipeThrough(MpdParsers.transformToTyped())
 *   .pipeTo(MpdParsers.takeFirstObject());
 * console.log(statusObject.state); // 'play', 'pause', or 'stop'
 * ```
 *
 * @example Usage with `playlistinfo` (list of objects)
 * ```typescript
 * const playlistStream = await client.sendCommand('playlistinfo');
 * const playlistItems = await playlistStream
 *   .pipeThrough(MpdParsers.transformToList({ delimiterKeys: 'file' }))
 *   .pipeThrough(MpdParsers.transformToTyped())
 *   .pipeTo(MpdParsers.aggregateToList());
 * for (const item of playlistItems) {
 *   console.log(item.file, item.title);
 * }
 * ```
 */
export namespace Parsers {
	/**
	 * Creates a TransformStream that parses MPD response lines into distinct JavaScript objects.
	 * It groups lines into objects based on the specified `delimiterKeys`.
	 * Each object emitted corresponds to one entry in the MPD list (e.g., one song, one directory).
	 * Duplicate keys within an object will result in the last value overwriting previous ones.
	 *
	 * @example Input lines for `playlistinfo`:
	 * ```
	 * file: track1.mp3
	 * Title: Track 1
	 * Artist: Artist A
	 * file: track2.ogg
	 * Title: Track 2
	 * Artist: Artist B
	 * OK
	 * ```
	 * With `delimiterKeys: ['file']`, the output stream emits:
	 * ```js
	 * { file: 'track1.mp3', title: 'Track 1', artist: 'Artist A' }
	 * { file: 'track2.ogg', title: 'Track 2', artist: 'Artist B' }
	 * ```
	 *
	 * @param options - Optional configuration for parsing.
	 * @param options.delimiterKeys - Key(s) marking the start of a new object (e.g., 'file').
	 * @param options.normalizeKeys - Whether to normalize keys (default: true).
	 * @returns A TransformStream that converts ResponseLine streams to object streams.
	 */
	export function transformToList(
		options?: ListParserOptions,
	): TransformStream<ResponseLine, Record<string, unknown>> {
		const { delimiterKeys, normalizeKeys } = options ?? {};
		const transformer = new LineToListTransformer(delimiterKeys, normalizeKeys);

		return new TransformStream<ResponseLine, Record<string, unknown>>({
			transform(line, controller) {
				transformer.transform(line, (item) => {
					controller.enqueue(item);
				});
			},

			flush(controller) {
				transformer.flush((item) => {
					controller.enqueue(item);
				});
			},
		});
	}

	/**
	 * Creates a TransformStream similar to `transformToList`, but generates a nested structure
	 * based on the order of `delimiterKeys`. When a delimiter key appears that is later
	 * in the `delimiterKeys` array than the current object's delimiter, the new object
	 * is added to a `children` array within the current object.
	 * Useful for commands like `lsinfo` that return hierarchical data.
	 *
	 * @example Input lines for `lsinfo "/"`:
	 * ```
	 * directory: Music
	 * Last-Modified: 2024-01-01T00:00:00Z
	 * file: Music/song1.mp3
	 * Title: Song 1
	 * file: Music/song2.ogg
	 * directory: Podcasts
	 * Last-Modified: 2024-02-01T00:00:00Z
	 * file: Podcasts/episode1.mp3
	 * OK
	 * ```
	 * With `delimiterKeys: ['directory', 'file']`, the output stream emits:
	 * ```js
	 * {
	 *   directory: 'Music',
	 *   lastModified: '2024-01-01T00:00:00Z',
	 *   children: [
	 *     { file: 'Music/song1.mp3', title: 'Song 1' },
	 *     { file: 'Music/song2.ogg' }
	 *   ]
	 * },
	 * {
	 *   directory: 'Podcasts',
	 *   lastModified: '2024-02-01T00:00:00Z',
	 *   children: [
	 *     { file: 'Podcasts/episode1.mp3' }
	 *   ]
	 * }
	 * ```
	 * Note: `children` property is automatically added to parent objects.
	 *
	 * @param options - Optional configuration for parsing.
	 * @param options.delimiterKeys - Key(s) defining the hierarchy, ordered from parent to child (e.g., `['directory', 'file']`).
	 * @param options.normalizeKeys - Whether to normalize keys (default: true).
	 * @returns A TransformStream that converts ResponseLine streams to potentially nested object streams.
	 */
	export function transformToListAndAccumulate(
		options?: ListParserOptions,
	): TransformStream<ResponseLine, Record<string, unknown>> {
		const { delimiterKeys, normalizeKeys } = options ?? {};
		const transformer = new LineToListAndAccumulateTransformer(
			delimiterKeys,
			normalizeKeys,
		);

		return new TransformStream<ResponseLine, Record<string, unknown>>({
			transform(line, controller) {
				transformer.transform(line, (item) => {
					controller.enqueue(item);
				});
			},

			flush(controller) {
				transformer.flush((item) => {
					controller.enqueue(item);
				});
			},
		});
	}

	/**
	 * Creates a TransformStream that parses MPD response lines into a single JavaScript object.
	 * Assumes the response represents one entity (like `status` or `currentsong`).
	 * It collects all key-value pairs until the stream ends and emits a single object.
	 * If the stream contains multiple logical objects (based on typical MPD list delimiters),
	 * only the *first* complete object encountered is emitted.
	 *
	 * @example Input lines for `status`:
	 * ```
	 * volume: 50
	 * repeat: 0
	 * state: play
	 * OK
	 * ```
	 * The output stream emits a single object:
	 * ```js
	 * { volume: '50', repeat: '0', state: 'play' }
	 * ```
	 *
	 * @param options - Optional configuration for parsing.
	 * @param options.normalizeKeys - Whether to normalize keys (default: true).
	 * @returns A TransformStream that converts a ResponseLine stream to a single object stream.
	 */
	export function transformToObject(
		options?: ObjectParsingOptions,
	): TransformStream<ResponseLine, Record<string, unknown>> {
		const { normalizeKeys } = options ?? {};
		const transformer = new LineToListTransformer(undefined, normalizeKeys);
		let isSent = false;

		return new TransformStream<ResponseLine, Record<string, unknown>>({
			transform(line, controller) {
				transformer.transform(line, (item) => {
					if (!isSent) {
						controller.enqueue(item);
						isSent = true;
					}
				});
			},

			flush(controller) {
				transformer.flush((item) => {
					if (!isSent) {
						controller.enqueue(item);
						isSent = true;
					}
				});
			},
		});
	}

	/**
	 * Creates a TransformStream that converts raw key-value objects (Record<string, unknown>)
	 * into objects with typed values (MpdTypedObject).
	 * It uses the `fieldParsers` mapping to convert string values based on normalized keys
	 * (e.g., 'volume' string '50' becomes number 50).
	 * Keys not found in `fieldParsers` retain their original string values.
	 * If a value is an array (from `transformToListAndAccumulate`), each element is parsed.
	 *
	 * @example Input object (from `transformToObject`):
	 * ```js
	 * { volume: '50', repeat: '0', state: 'play', elapsed: '123.456' }
	 * ```
	 * The output stream emits a typed object:
	 * ```js
	 * { volume: 50, repeat: false, state: 'play', elapsed: 123.456 }
	 * ```
	 *
	 * @returns A TransformStream that converts raw objects to typed objects.
	 */
	export function transformToTyped(): TransformStream<
		Record<string, unknown>,
		MpdTypedObject
	> {
		return new TransformStream<Record<string, unknown>, MpdTypedObject>({
			transform(rawObject, controller) {
				const typedObject: MpdTypedObject = {};
				for (const [rawKey, rawValue] of Object.entries(rawObject)) {
					const key = normalizeKey(rawKey);
					if (key in fieldParsers) {
						const parser = fieldParsers[key];
						if (Array.isArray(rawValue)) {
							typedObject[key] = rawValue.map((v) => parser(String(v)));
						} else {
							typedObject[key] = parser(String(rawValue));
						}
					} else {
						typedObject[key] = rawValue;
					}
				}
				controller.enqueue(typedObject);
			},
		});
	}

	/**
	 * Consumes a ReadableStream of `ResponseLine` and aggregates all raw lines
	 * into a single newline-separated string.
	 * Useful for commands that return unstructured text, like `listplaylists`.
	 *
	 * @param stream - The ReadableStream of ResponseLine to consume.
	 * @returns A promise that resolves with the aggregated string content.
	 */
	export async function aggregateToString(
		stream: ReadableStream<ResponseLine>,
	): Promise<string> {
		const rawTexts: string[] = [];
		for await (const line of stream) {
			rawTexts.push(line.raw);
		}
		return rawTexts.join("\n");
	}

	/**
	 * Consumes a ReadableStream and aggregates all items emitted by it into an array.
	 * Generic utility for collecting results from transforming parsers like `transformToList`.
	 *
	 * @template T The type of items in the stream.
	 * @param stream - The ReadableStream to consume.
	 * @returns A promise that resolves with an array containing all items from the stream.
	 */
	export async function aggregateToList<T>(
		stream: ReadableStream<T>,
	): Promise<T[]> {
		const list = [];
		for await (const item of stream) {
			list.push(item);
		}
		return list;
	}

	/**
	 * Consumes a ReadableStream and returns the *first* item emitted by it.
	 * Useful for streams expected to yield only one object, like the output of `transformToObject`.
	 * Returns undefined if the stream completes without emitting any items.
	 *
	 * @template T The type of item in the stream.
	 * @param stream - The ReadableStream to consume.
	 * @returns A promise that resolves with the first item from the stream.
	 */
	export async function takeFirstObject<T>(
		stream: ReadableStream<T>,
	): Promise<T | undefined> {
		for await (const item of stream) {
			return item;
		}
		return undefined;
	}

	/**
	 * Consumes a ReadableStream of `ResponseLine` and returns the *value*
	 * of the first key-value pair encountered.
	 * Useful for commands that return a single value, like `count`.
	 * Returns undefined if the stream completes without emitting a valid key-value line.
	 *
	 * @param stream - The ReadableStream of ResponseLine to consume.
	 * @returns A promise that resolves with the string value of the first line.
	 */
	export async function takeFirstLineValue(
		stream: ReadableStream<ResponseLine>,
	): Promise<string | undefined> {
		for await (const line of stream) {
			const kvPair = parseLineToKeyValue(line.raw);
			if (kvPair) {
				return kvPair[1];
			}
			break;
		}
		return undefined;
	}

	/**
	 * Consumes a ReadableStream of `ResponseLine` and returns the *binary data*
	 * associated with the first line that contains it.
	 * Primarily used for commands like `readpicture` or `albumart`.
	 * Returns undefined if the stream completes without emitting any binary data.
	 *
	 * @param stream - The ReadableStream of ResponseLine to consume.
	 * @returns A promise that resolves with the Buffer containing the binary data.
	 */
	export async function takeFirstBinary(
		stream: ReadableStream<ResponseLine>,
	): Promise<Buffer | undefined> {
		for await (const line of stream) {
			if (line.binaryData) {
				return line.binaryData;
			}
		}
		return undefined;
	}
}
