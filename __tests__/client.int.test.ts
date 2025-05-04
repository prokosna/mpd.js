import { Client, Parsers, MpdError, Command } from "../lib";
import { expect, describe, beforeAll, afterAll, it } from "vitest";

describe("MpdClient Integration Tests", () => {
	let client: Client;

	beforeAll(async () => {
		client = await Client.connect({
			host: process.env.MPD_HOST || "localhost",
			port: Number.parseInt(process.env.MPD_PORT || "6600", 10),
		});

		try {
			await client.sendCommand("clear");

			const listAllInfo = await client
				.streamCommand("listallinfo")
				.then((stream) =>
					stream.pipeThrough(
						Parsers.transformToList({ delimiterKeys: "file" }),
					),
				);
			const songs = await Parsers.aggregateToList(listAllInfo);

			if (songs.length > 0) {
				const addCommands = songs.map((song) =>
					Command.cmd("add", String(song.file)),
				);
				await client.sendCommands(addCommands);
			} else {
				console.warn(
					"MPD library is empty. Playback tests might not behave as expected.",
				);
			}
		} catch (error) {
			console.error("Error preparing playlist for tests:", error);
			throw error;
		}
	});

	afterAll(async () => {
		if (client) {
			await client.disconnect();
		}
	});

	describe("Connection", () => {
		it("should connect to MPD server", async () => {
			expect(client).toBeDefined();
			await expect(client.sendCommand("ping")).resolves.toBeDefined();
			expect(client.PROTOCOL_VERSION).toBeDefined();
		});

		it("should handle connection errors", async () => {
			await expect(
				Client.connect({
					host: "invalid-host",
					port: 6600,
					timeout: 1000,
				}),
			).rejects.toThrow();
		}, 5000);
	});

	describe("Commands", () => {
		it("should get status", async () => {
			const result = await client
				.streamCommand("status")
				.then((stream) => stream.pipeThrough(Parsers.transformToObject()))
				.then(Parsers.takeFirstObject);
			expect(result).toHaveProperty("volume");
			expect(result).toHaveProperty("state");
		});

		it("should get statistics", async () => {
			const result = await client
				.streamCommand("stats")
				.then((stream) => stream.pipeThrough(Parsers.transformToObject()))
				.then(Parsers.takeFirstObject);
			expect(result).toHaveProperty("artists");
			expect(result).toHaveProperty("albums");
			expect(result).toHaveProperty("songs");
			expect(result).toHaveProperty("uptime");
		});

		it("should send command with arguments (setvol)", async () => {
			const command = Command.cmd("setvol", [50]);
			await expect(client.sendCommand(command)).resolves.toBeDefined();

			const status = await client
				.streamCommand("status")
				.then((stream) =>
					stream
						.pipeThrough(Parsers.transformToObject())
						.pipeThrough(Parsers.transformToTyped()),
				)
				.then(Parsers.takeFirstObject);
			expect(status?.volume).toBe(50);
		});

		it("should send multiple commands using sendCommands", async () => {
			const commands = ["status", Command.cmd("setvol", [60])];
			await expect(client.sendCommands(commands)).resolves.toBeDefined();
			const status = await client
				.streamCommand("status")
				.then((stream) =>
					stream
						.pipeThrough(Parsers.transformToObject())
						.pipeThrough(Parsers.transformToTyped()),
				)
				.then(Parsers.takeFirstObject);
			expect(status?.volume).toBe(60);
		});

		it("should send multiple commands using streamCommands", async () => {
			const commands = ["status", Command.cmd("setvol", [60])];
			await expect(
				client.streamCommands(commands).then(Parsers.aggregateToString),
			).resolves.toBeDefined();
			const status = await client
				.streamCommand("status")
				.then((stream) =>
					stream
						.pipeThrough(Parsers.transformToObject())
						.pipeThrough(Parsers.transformToTyped()),
				)
				.then(Parsers.takeFirstObject);
			expect(status?.volume).toBe(60);
		});

		it("should control playback state (stop, play, pause)", async () => {
			await client.sendCommand("stop");
			let status = await client
				.streamCommand("status")
				.then((stream) => stream.pipeThrough(Parsers.transformToObject()))
				.then(Parsers.takeFirstObject);
			expect(status?.state).toBe("stop");

			await client.sendCommand("play");
			status = await client
				.streamCommand("status")
				.then((stream) => stream.pipeThrough(Parsers.transformToObject()))
				.then(Parsers.takeFirstObject);
			expect(status?.state).toBeDefined();

			if (status?.state === "play") {
				await client.sendCommand(Command.cmd("pause", [1]));
				status = await client
					.streamCommand("status")
					.then((stream) => stream.pipeThrough(Parsers.transformToObject()))
					.then(Parsers.takeFirstObject);
				expect(status?.state).toBe("pause");

				await client.sendCommand(Command.cmd("pause", [0]));
				status = await client
					.streamCommand("status")
					.then((stream) => stream.pipeThrough(Parsers.transformToObject()))
					.then(Parsers.takeFirstObject);
				expect(status?.state).toBe("play");
			}
		});

		it("should handle command errors", async () => {
			await expect(client.sendCommand("invalid_command")).rejects.toThrow(
				MpdError,
			);
			try {
				await client.sendCommand("invalid_command");
			} catch (e) {
				expect(e).toBeInstanceOf(MpdError);
			}
		});
	});

	describe("Events", () => {
		it("should emit system events by play", () =>
			new Promise<void>((done) => {
				const handler = (name: string) => {
					expect(typeof name).toBe("string");
					client.off("system", handler);
					done();
				};
				client.on("system", handler);
				client.sendCommand(Command.cmd("play")).catch((err) => {
					console.warn(
						"Play command failed during event test, might be ok:",
						err,
					);
				});
			}));

		it("should emit system events by pause", () =>
			new Promise<void>((done) => {
				const handler = (name: string) => {
					expect(typeof name).toBe("string");
					client.off("system", handler);
					done();
				};
				client.on("system", handler);
				client.sendCommand(Command.cmd("pause")).catch((err) => {
					console.warn(
						"Pause command failed during event test, might be ok:",
						err,
					);
				});
			}));

		it("should emit close event", () =>
			new Promise<void>((done) => {
				Client.connect({
					host: process.env.MPD_HOST || "localhost",
					port: Number.parseInt(process.env.MPD_PORT || "6600", 10),
				})
					.then((newClient) => {
						newClient.on("close", done);
						newClient.disconnect();
					})
					.catch(done);
			}));
	});

	describe("Parsers", () => {
		it("should parse status response using takeFirstObject", async () => {
			const status = await client
				.streamCommand("status")
				.then((stream) =>
					stream
						.pipeThrough(Parsers.transformToObject())
						.pipeThrough(Parsers.transformToTyped()),
				)
				.then(Parsers.takeFirstObject);
			expect(typeof status?.volume).toBe("number");
			expect(typeof status?.repeat).toBe("boolean");
			expect(["play", "stop", "pause"]).toContain(status?.state);
		});

		it("should parse list response using aggregateToList", async () => {
			const listAll = await client
				.streamCommand("listallinfo")
				.then((stream) =>
					stream.pipeThrough(
						Parsers.transformToList({ delimiterKeys: "file" }),
					),
				)
				.then(Parsers.aggregateToList);
			expect(Array.isArray(listAll)).toBe(true);
			if (listAll.length > 0) {
				expect(listAll[0]).toHaveProperty("file");
			}
		});

		it("should parse status information with audio format", async () => {
			const status = await client
				.streamCommand("status")
				.then((stream) => stream.pipeThrough(Parsers.transformToObject()))
				.then(Parsers.takeFirstObject);

			expect(status).toBeDefined();
			if (!status) return;
			expect(typeof status).toBe("object");

			const commonProps = [
				"volume",
				"repeat",
				"random",
				"single",
				"consume",
				"playlist",
			];
			const hasCommonProps = commonProps.some((prop) => prop in status);
			expect(hasCommonProps).toBe(true);

			if (status.audio) {
				expect(typeof status.audio).toBe("string");
				const audioParts = (status.audio as string).split(":");
				expect(audioParts.length).toBeGreaterThanOrEqual(1);
				expect(Number.parseInt(audioParts[0], 10)).toBeGreaterThan(0);
				if (audioParts.length > 1) {
					expect(Number.parseInt(audioParts[1], 10)).toBeGreaterThan(0);
				}
				if (audioParts.length > 2) {
					expect(Number.parseInt(audioParts[2], 10)).toBeGreaterThan(0);
				}
			}
		});

		it("should handle search command using aggregateToList", async () => {
			const result = await client
				.streamCommand(Command.cmd("search", ["any", "test"]))
				.then((stream) =>
					stream.pipeThrough(
						Parsers.transformToList({ delimiterKeys: "file" }),
					),
				)
				.then(Parsers.aggregateToList);
			expect(Array.isArray(result)).toBe(true);

			if (result.length > 0) {
				const song = result[0];
				expect(song).toHaveProperty("file");
				const metadataKeys = ["title", "artist", "album", "time", "duration"];
				const hasMetadata = metadataKeys.some((key) => key in song);
				expect(hasMetadata).toBe(true);
			}
		});
	});
});
