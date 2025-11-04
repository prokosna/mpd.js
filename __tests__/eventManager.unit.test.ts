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
});
