import { EventEmitter } from "node:events";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NetConnectOpts, Socket } from "node:net";
import { OK } from "../lib/const";
import { ConnectionPool } from "../lib/connection";

class SimpleMockSocket extends EventEmitter {
	destroyed = false;
	connect = vi
		.fn()
		.mockImplementation((_opts: unknown, callback?: () => void) => {
			process.nextTick(() => {
				this.emit("connect");
				if (callback) callback();
			});
			return this;
		});
	write = vi.fn();
	end = vi.fn().mockImplementation(() => {
		process.nextTick(() => {
			this.destroyed = true;
			this.emit("close");
		});
		return this;
	});
	destroy = vi.fn().mockImplementation((err?: Error) => {
		this.destroyed = true;
		if (err) {
			process.nextTick(() => this.emit("error", err));
		}
		process.nextTick(() => this.emit("close"));
		return this;
	});
	setEncoding = vi.fn(() => this);
	simulateData = (data: string) => {
		this.emit("data", Buffer.from(data));
	};
	simulateError = (err: Error) => {
		this.emit("error", err);
	};
	simulateClose = () => {
		this.destroyed = true;
		this.emit("close");
	};
	removeAllListeners = vi.fn(() => this);
	ref = vi.fn(() => this);
	unref = vi.fn(() => this);
	once = vi
		.fn()
		.mockImplementation(
			(event: string, listener: (...args: unknown[]) => void) => {
				super.once(event, listener);
				return this;
			},
		);
}

let createdSockets: SimpleMockSocket[] = [];
let shouldFailNextConnection = false;

const mocks = vi.hoisted(() => {
	const mockCreateConnectionFn = (config: NetConnectOpts): Socket => {
		const socket = new SimpleMockSocket();
		createdSockets.push(socket);

		if (shouldFailNextConnection) {
			process.nextTick(() => {
				socket.simulateError(new Error("ECONNREFUSED"));
			});
		} else {
			process.nextTick(() => socket.emit("connect"));
		}

		return socket as unknown as Socket;
	};
	return {
		mockCreateConnection: vi.fn(mockCreateConnectionFn),
	};
});

vi.mock("node:net", () => {
	return {
		__esModule: true,
		createConnection: mocks.mockCreateConnection,
	};
});

describe("ConnectionPool - MPD Process Death and Recovery", () => {
	let unhandledRejections: Error[] = [];

	beforeEach(() => {
		vi.clearAllMocks();
		createdSockets = [];
		shouldFailNextConnection = false;
		vi.useRealTimers();
		unhandledRejections = [];

		process.on("unhandledRejection", (reason: Error) => {
			unhandledRejections.push(reason);
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		process.removeAllListeners("unhandledRejection");
	});

	it("should remove failed connection promise from pool on connection failure", async () => {
		vi.useFakeTimers();
		const pool = new ConnectionPool({
			host: "localhost",
			port: 6600,
			timeout: 100,
			poolSize: 3,
		});

		shouldFailNextConnection = true;
		const getConnectionPromise = pool.getConnection().catch((error) => {
			throw error;
		});

		await vi.advanceTimersByTimeAsync(150);

		try {
			await getConnectionPromise;
			throw new Error("Expected getConnection to fail but it succeeded");
		} catch (error) {
			expect((error as Error).message).toContain(
				"Failed to create new connection",
			);
		}

		// MPD comes back up
		shouldFailNextConnection = false;
		const getConnectionPromise2 = pool.getConnection();
		await vi.advanceTimersByTimeAsync(10);

		const lastSocket = createdSockets[createdSockets.length - 1];
		lastSocket.simulateData(`${OK} MPD 0.23.5\n`);

		const connection = await getConnectionPromise2;
		expect(connection).toBeDefined();
		expect(connection.getMpdVersion()).toBe("0.23.5");

		await pool.disconnectAll();
		vi.useRealTimers();
	});

	it("should recover after multiple connection failures when MPD comes back", async () => {
		vi.useFakeTimers();
		const poolSize = 3;
		const pool = new ConnectionPool({
			host: "localhost",
			port: 6600,
			timeout: 100,
			poolSize,
		});

		shouldFailNextConnection = true;

		// Fill the pool with failed connections
		const failedPromises = [];
		for (let i = 0; i < poolSize; i++) {
			failedPromises.push(
				pool.getConnection().catch((error) => {
					throw error;
				}),
			);
		}

		await vi.advanceTimersByTimeAsync(150);

		for (const promise of failedPromises) {
			try {
				await promise;
				throw new Error("Expected promise to fail");
			} catch (error) {
				expect((error as Error).message).toContain(
					"Failed to create new connection",
				);
			}
		}

		// MPD comes back up - should be able to create new connection
		shouldFailNextConnection = false;
		const getConnectionPromise = pool.getConnection();
		await vi.advanceTimersByTimeAsync(10);

		const lastSocket = createdSockets[createdSockets.length - 1];
		lastSocket.simulateData(`${OK} MPD 0.23.5\n`);

		const connection = await getConnectionPromise;
		expect(connection).toBeDefined();
		expect(connection.getMpdVersion()).toBe("0.23.5");

		await pool.disconnectAll();
		vi.useRealTimers();
	});

	it("should handle connection close during active use and recover", async () => {
		vi.useFakeTimers();
		const pool = new ConnectionPool({
			host: "localhost",
			port: 6600,
			timeout: 100,
			poolSize: 3,
		});

		shouldFailNextConnection = false;
		const getConnectionPromise = pool.getConnection();
		await vi.advanceTimersByTimeAsync(10);

		const firstSocket = createdSockets[createdSockets.length - 1];
		firstSocket.simulateData(`${OK} MPD 0.23.5\n`);

		const connection = await getConnectionPromise;
		expect(connection).toBeDefined();

		// Simulate MPD process death
		firstSocket.simulateClose();
		await vi.advanceTimersByTimeAsync(10);

		// Try to get connection while MPD is down
		shouldFailNextConnection = true;
		const failedGetConnection = pool.getConnection().catch((error) => {
			throw error;
		});
		await vi.advanceTimersByTimeAsync(150);
		try {
			await failedGetConnection;
			throw new Error("Expected failedGetConnection to fail");
		} catch (error) {
			expect((error as Error).message).toContain(
				"Failed to create new connection",
			);
		}

		// MPD comes back up
		shouldFailNextConnection = false;
		const recoveryGetConnection = pool.getConnection();
		await vi.advanceTimersByTimeAsync(10);

		const lastSocket = createdSockets[createdSockets.length - 1];
		lastSocket.simulateData(`${OK} MPD 0.23.5\n`);

		const recoveredConnection = await recoveryGetConnection;
		expect(recoveredConnection).toBeDefined();
		expect(recoveredConnection.getMpdVersion()).toBe("0.23.5");

		await pool.disconnectAll();
		vi.useRealTimers();
	});

	it("should clean up destroyed sockets on getConnection call", async () => {
		vi.useFakeTimers();
		const pool = new ConnectionPool({
			host: "localhost",
			port: 6600,
			timeout: 100,
			poolSize: 3,
		});

		shouldFailNextConnection = false;
		const getConnectionPromise = pool.getConnection();
		await vi.advanceTimersByTimeAsync(10);

		const firstSocket = createdSockets[createdSockets.length - 1];
		firstSocket.simulateData(`${OK} MPD 0.23.5\n`);

		const connection = await getConnectionPromise;
		expect(connection).toBeDefined();

		await pool.releaseConnection(connection);

		// Socket destroyed while idle in pool
		firstSocket.simulateClose();
		await vi.advanceTimersByTimeAsync(10);

		// getConnection should detect destroyed socket and create new one
		const newConnectionPromise = pool.getConnection();
		await vi.advanceTimersByTimeAsync(10);

		const newSocket = createdSockets[createdSockets.length - 1];
		newSocket.simulateData(`${OK} MPD 0.23.5\n`);

		const newConnection = await newConnectionPromise;
		expect(newConnection).toBeDefined();
		expect(newConnection).not.toBe(connection);

		await pool.disconnectAll();
		vi.useRealTimers();
	});
});
