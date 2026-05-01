import { EventEmitter } from "node:events";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventManager } from "../lib/event";
import { ConnectionPool } from "../lib/connection";
import type { Config } from "../lib/client";

class MockSocket extends EventEmitter {
	write = vi.fn((data: string, encoding: string, callback?: () => void) => {
		if (callback) callback();
		return true;
	});
	end = vi.fn();
	destroyed = false;
	removeAllListeners = vi.fn(() => this);
}

class MockConnection {
	socket: MockSocket;
	private version: string;

	constructor(version = "0.23.5") {
		this.socket = new MockSocket();
		this.version = version;
	}

	getMpdVersion(): string {
		return this.version;
	}

	async disconnect(): Promise<void> {
		this.socket.destroyed = true;
	}

	isBusy(): boolean {
		return false;
	}
}

describe("EventManager Reconnection", () => {
	let emitter: EventEmitter;
	let connectionPool: ConnectionPool;
	let config: Config;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();

		emitter = new EventEmitter();
		config = {
			host: "localhost",
			port: 6600,
			poolSize: 3,
			reconnectDelay: 100,
			maxRetries: 3,
		};

		connectionPool = new ConnectionPool(config);
	});

	afterEach(async () => {
		vi.useRealTimers();
		await connectionPool.disconnectAll();
	});

	it("should start monitoring successfully", async () => {
		const mockConnection = new MockConnection();

		vi.spyOn(connectionPool, "createDedicatedConnection").mockResolvedValue(
			// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
			mockConnection as any,
		);

		const eventManager = new EventManager(emitter, connectionPool, config);
		const version = await eventManager.startMonitoring();

		expect(version).toBe("0.23.5");
		expect(mockConnection.socket.write).toHaveBeenCalledWith(
			"idle\n",
			"utf8",
			expect.any(Function),
		);

		await eventManager.stopMonitoring();
	});

	it("should automatically reconnect when connection closes", async () => {
		vi.useFakeTimers();

		const mockConnection1 = new MockConnection();
		const mockConnection2 = new MockConnection();

		const createSpy = vi
			.spyOn(connectionPool, "createDedicatedConnection")
			// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
			.mockResolvedValueOnce(mockConnection1 as any)
			// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
			.mockResolvedValueOnce(mockConnection2 as any);

		const eventManager = new EventManager(emitter, connectionPool, config);
		await eventManager.startMonitoring();

		expect(createSpy).toHaveBeenCalledTimes(1);

		mockConnection1.socket.emit("close", false);

		await vi.advanceTimersByTimeAsync(config.reconnectDelay || 100);

		expect(createSpy).toHaveBeenCalledTimes(2);
		expect(mockConnection2.socket.write).toHaveBeenCalledWith(
			"idle\n",
			"utf8",
			expect.any(Function),
		);

		await eventManager.stopMonitoring();
	});

	it("should emit close event after max retries", async () => {
		vi.useFakeTimers();

		const mockConnection = new MockConnection();
		let callCount = 0;

		vi.spyOn(connectionPool, "createDedicatedConnection").mockImplementation(
			async () => {
				callCount++;
				if (callCount === 1) {
					// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
					return mockConnection as any;
				}
				throw new Error("Connection failed");
			},
		);

		const eventManager = new EventManager(emitter, connectionPool, config);
		const closePromise = new Promise<Error | undefined>((resolve) => {
			emitter.once("close", (error) => resolve(error));
		});

		await eventManager.startMonitoring();

		mockConnection.socket.emit("close", false);

		for (let i = 0; i < (config.maxRetries || 3); i++) {
			await vi.advanceTimersByTimeAsync(config.reconnectDelay || 100);
		}

		const error = await closePromise;
		expect(error).toBeInstanceOf(Error);
		expect(error?.message).toContain("max reconnection attempts");
	});

	it("should stop reconnection attempts when stopMonitoring is called", async () => {
		vi.useFakeTimers();

		const mockConnection = new MockConnection();
		const createSpy = vi
			.spyOn(connectionPool, "createDedicatedConnection")
			// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
			.mockResolvedValue(mockConnection as any);

		const eventManager = new EventManager(emitter, connectionPool, config);
		await eventManager.startMonitoring();

		mockConnection.socket.emit("close", false);

		await eventManager.stopMonitoring();

		await vi.advanceTimersByTimeAsync(config.reconnectDelay || 100);

		expect(createSpy).toHaveBeenCalledTimes(1);
	});

	it("should handle connection close with error", async () => {
		vi.useFakeTimers();

		const mockConnection1 = new MockConnection();
		const mockConnection2 = new MockConnection();

		vi.spyOn(connectionPool, "createDedicatedConnection")
			// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
			.mockResolvedValueOnce(mockConnection1 as any)
			// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
			.mockResolvedValueOnce(mockConnection2 as any);

		const eventManager = new EventManager(emitter, connectionPool, config);
		await eventManager.startMonitoring();

		mockConnection1.socket.emit("close", true);

		await vi.advanceTimersByTimeAsync(config.reconnectDelay || 100);

		expect(mockConnection2.socket.write).toHaveBeenCalledWith(
			"idle\n",
			"utf8",
			expect.any(Function),
		);

		await eventManager.stopMonitoring();
	});

	it("should emit error events during reconnection failures", async () => {
		vi.useFakeTimers();

		const mockConnection = new MockConnection();
		let callCount = 0;

		vi.spyOn(connectionPool, "createDedicatedConnection").mockImplementation(
			async () => {
				callCount++;
				if (callCount === 1) {
					// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
					return mockConnection as any;
				}
				throw new Error("Reconnection failed");
			},
		);

		const eventManager = new EventManager(emitter, connectionPool, config);
		await eventManager.startMonitoring();

		mockConnection.socket.emit("close", false);

		for (let i = 0; i < (config.maxRetries || 3); i++) {
			await vi.advanceTimersByTimeAsync(config.reconnectDelay || 100);
		}

		await eventManager.stopMonitoring();
	});

	it("should continue emitting system events after reconnection", async () => {
		vi.useFakeTimers();

		const mockConnection1 = new MockConnection();
		const mockConnection2 = new MockConnection();

		vi.spyOn(connectionPool, "createDedicatedConnection")
			// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
			.mockResolvedValueOnce(mockConnection1 as any)
			// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
			.mockResolvedValueOnce(mockConnection2 as any);

		const eventManager = new EventManager(emitter, connectionPool, config);
		await eventManager.startMonitoring();

		const systemEvents: string[] = [];
		emitter.on("system", (subsystem) => {
			systemEvents.push(subsystem);
		});

		mockConnection1.socket.emit("data", Buffer.from("changed: player\nOK\n"));

		mockConnection1.socket.emit("close", false);
		await vi.advanceTimersByTimeAsync(config.reconnectDelay || 100);

		mockConnection2.socket.emit("data", Buffer.from("changed: mixer\nOK\n"));

		expect(systemEvents).toContain("player");
		expect(systemEvents).toContain("mixer");

		await eventManager.stopMonitoring();
	});

	describe("Line buffering across data chunks", () => {
		it("should not emit a partial event when 'changed: player' is split mid-line", async () => {
			const mockConnection = new MockConnection();
			vi.spyOn(connectionPool, "createDedicatedConnection").mockResolvedValue(
				// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
				mockConnection as any,
			);

			const eventManager = new EventManager(emitter, connectionPool, config);
			await eventManager.startMonitoring();

			const systemEvents: string[] = [];
			emitter.on("system", (subsystem) => {
				systemEvents.push(subsystem);
			});

			// Split a single MPD response across multiple data events.
			// The first chunk ends mid-line ("pla") and must NOT be flushed
			// as a bogus 'system-pla' event.
			mockConnection.socket.emit("data", Buffer.from("changed: pla"));
			expect(systemEvents).toEqual([]);

			mockConnection.socket.emit("data", Buffer.from("yer\nOK\n"));
			expect(systemEvents).toEqual(["player"]);

			await eventManager.stopMonitoring();
		});

		it("should emit multiple events when several lines arrive in one chunk", async () => {
			const mockConnection = new MockConnection();
			vi.spyOn(connectionPool, "createDedicatedConnection").mockResolvedValue(
				// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
				mockConnection as any,
			);

			const eventManager = new EventManager(emitter, connectionPool, config);
			await eventManager.startMonitoring();

			const systemEvents: string[] = [];
			emitter.on("system", (subsystem) => {
				systemEvents.push(subsystem);
			});

			mockConnection.socket.emit(
				"data",
				Buffer.from("changed: player\nchanged: mixer\nOK\n"),
			);

			expect(systemEvents).toEqual(["player", "mixer"]);

			await eventManager.stopMonitoring();
		});

		it("should not detect 'OK' when split across two chunks until both arrive", async () => {
			const mockConnection = new MockConnection();
			vi.spyOn(connectionPool, "createDedicatedConnection").mockResolvedValue(
				// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
				mockConnection as any,
			);

			const eventManager = new EventManager(emitter, connectionPool, config);
			await eventManager.startMonitoring();

			// Initial idle write happens during startMonitoring.
			expect(mockConnection.socket.write).toHaveBeenCalledTimes(1);

			// 'O' alone must not trigger the OK branch (which would write 'idle\n' again).
			mockConnection.socket.emit("data", Buffer.from("changed: player\nO"));
			expect(mockConnection.socket.write).toHaveBeenCalledTimes(1);

			// Once the rest of the line arrives, OK is recognized and re-idle is sent.
			mockConnection.socket.emit("data", Buffer.from("K\n"));
			expect(mockConnection.socket.write).toHaveBeenCalledTimes(2);
			expect(mockConnection.socket.write).toHaveBeenLastCalledWith(
				"idle\n",
				"utf8",
				expect.any(Function),
			);

			await eventManager.stopMonitoring();
		});

		it("should reset the line buffer on reconnect", async () => {
			vi.useFakeTimers();

			const mockConnection1 = new MockConnection();
			const mockConnection2 = new MockConnection();

			vi.spyOn(connectionPool, "createDedicatedConnection")
				// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
				.mockResolvedValueOnce(mockConnection1 as any)
				// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
				.mockResolvedValueOnce(mockConnection2 as any);

			const eventManager = new EventManager(emitter, connectionPool, config);
			await eventManager.startMonitoring();

			const systemEvents: string[] = [];
			emitter.on("system", (subsystem) => {
				systemEvents.push(subsystem);
			});

			// Send a partial line on the first connection, then close before
			// the line completes. The leftover bytes must NOT bleed into the
			// next connection's buffer.
			mockConnection1.socket.emit("data", Buffer.from("changed: pla"));
			mockConnection1.socket.emit("close", false);

			await vi.advanceTimersByTimeAsync(config.reconnectDelay || 100);

			// On the new connection, deliver a fresh, complete event.
			mockConnection2.socket.emit("data", Buffer.from("changed: mixer\nOK\n"));

			// Only 'mixer' should be observed; the dangling 'pla' from the
			// previous connection must not produce 'plamixer' or any partial.
			expect(systemEvents).toEqual(["mixer"]);

			await eventManager.stopMonitoring();
		});
	});

	describe("startMonitoring failure contract", () => {
		it("emits 'error' instead of throwing when createDedicatedConnection fails", async () => {
			const failure = new Error("ECONNREFUSED");
			vi.spyOn(connectionPool, "createDedicatedConnection").mockRejectedValue(
				failure,
			);

			const eventManager = new EventManager(emitter, connectionPool, config);

			const errors: Error[] = [];
			emitter.on("error", (err: Error) => {
				errors.push(err);
			});

			const result = await eventManager.startMonitoring();

			expect(result).toBeUndefined();
			expect(errors).toHaveLength(1);
			expect(errors[0]?.message).toContain("Failed to start monitoring");
			expect(errors[0]?.message).toContain(failure.message);
		});

		it("is single-flight: concurrent startMonitoring calls share one connection attempt", async () => {
			const mockConnection = new MockConnection();
			const createSpy = vi
				.spyOn(connectionPool, "createDedicatedConnection")
				.mockImplementation(
					// biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
					() => Promise.resolve(mockConnection as any),
				);

			const eventManager = new EventManager(emitter, connectionPool, config);

			const results = await Promise.all([
				eventManager.startMonitoring(),
				eventManager.startMonitoring(),
				eventManager.startMonitoring(),
			]);

			expect(createSpy).toHaveBeenCalledTimes(1);
			expect(results).toEqual(["0.23.5", "0.23.5", "0.23.5"]);

			await eventManager.stopMonitoring();
		});
	});
});
