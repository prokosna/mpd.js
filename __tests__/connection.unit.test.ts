import { jest } from "@jest/globals";
import { EventEmitter } from "node:events";
import type { SocketConnectOpts } from "node:net";
import { Connection, ConnectionPool } from "../lib/connection";
import type { Config } from "../lib/client";
import { OK, ACK_PREFIX } from "../lib/const";
import { MpdError } from "../lib/error";
import net from "node:net";
import { escapeArg } from "../lib/parserUtils";

// mockSocketInstance is defined and managed in beforeEach/afterEach
let mockSocketInstance: MockSocket | null;

type ConnectCallback = () => void;
type WriteCallback = (err?: Error) => void;
type EndCallback = () => void;
type DestroyCallback = (err?: Error) => void;

class MockSocket extends EventEmitter {
	destroyed = false;

	connect = jest
		.fn<
			(options: SocketConnectOpts, connectionListener?: ConnectCallback) => this
		>()
		.mockImplementation(
			(options: SocketConnectOpts, callback?: ConnectCallback) => {
				process.nextTick(() => {
					this.emit("connect");
					if (callback) callback();
				});
				return this;
			},
		);

	write = jest
		.fn<
			(
				chunk: string | Uint8Array,
				encodingOrCb?: BufferEncoding | WriteCallback | undefined,
				cb?: WriteCallback | undefined,
			) => boolean
		>()
		.mockImplementation(
			(
				data: string | Uint8Array,
				encodingOrCb?: BufferEncoding | WriteCallback,
				callback?: WriteCallback,
			) => {
				const actualCallback =
					typeof encodingOrCb === "function" ? encodingOrCb : callback;
				if (actualCallback) process.nextTick(actualCallback);
				return true;
			},
		);

	end = jest
		.fn<(cb?: () => void) => this>()
		.mockImplementation((callback?: EndCallback) => {
			process.nextTick(() => {
				if (!this.destroyed) {
					this.emit("close", false);
				}
				if (callback) callback();
			});
			return this;
		});

	destroy = jest
		.fn<(error?: Error, callback?: DestroyCallback) => this>()
		.mockImplementation((error?: Error, callback?: DestroyCallback) => {
			if (!this.destroyed) {
				this.destroyed = true;
				process.nextTick(() => {
					if (error) {
						this.emit("error", error);
					}
					this.emit("close", !!error);
					if (callback) callback(error);
				});
			} else if (callback) {
				process.nextTick(callback, error);
			}
			return this;
		});

	setEncoding = jest
		.fn<(encoding: BufferEncoding) => this>()
		.mockImplementation((encoding: BufferEncoding) => {
			return this;
		});

	simulateData(data: string): void {
		this.emit("data", Buffer.from(data));
	}

	simulateError(error: Error): void {
		this.emit("error", error);
	}

	simulateClose(hadError = false): void {
		if (this.destroyed) return;
		this.destroy(
			hadError ? new Error("Simulated close with error") : undefined,
		);
	}

	removeAllListeners(): this {
		return this;
	}
}

// Keep track of sockets created by the mock
let activeMockSockets: MockSocket[] = [];

// --- Mock node:net --- BEFORE describe block
jest.mock("node:net", () => ({
	createConnection: jest.fn().mockImplementation(() => {
		const newSocket = new MockSocket();
		activeMockSockets.push(newSocket);
		mockSocketInstance = newSocket;
		return newSocket as unknown as net.Socket;
	}),
	Socket: (jest.requireActual("node:net") as typeof net).Socket,
}));
// ---------------------

describe("Connection", () => {
	const options: Config = { host: "mockhost", port: 6600 };

	beforeEach(() => {
		jest.clearAllMocks();
		activeMockSockets = []; // Clear tracked sockets before each Connection test
		(net.createConnection as jest.Mock)();
		if (!mockSocketInstance) {
			throw new Error("mockSocketInstance was not set by the mock");
		}
		activeMockSockets = [mockSocketInstance]; // Keep only the one created for this test
	});

	afterEach(() => {
		mockSocketInstance?.removeAllListeners();
		mockSocketInstance?.destroy();
		mockSocketInstance = null;
	});

	it("Connection.connect(): should connect and resolve with Connection instance on OK", async () => {
		const connectPromise = Connection.connect(options);

		mockSocketInstance?.simulateData(`${OK} MPD 0.23.5\n`);

		const connection = await connectPromise;

		expect(connection).toBeInstanceOf(Connection);
		expect(connection.getMpdVersion()).toBe("0.23.5");

		connection.disconnect();
	});

	it("Connection.connect(): should send password command if password is provided", async () => {
		const password = "testpassword";
		const configWithPass: Config = { ...options, password };
		const connectPromise = Connection.connect(configWithPass);

		mockSocketInstance?.simulateData(`${OK} MPD 0.23.5\n`);

		expect(mockSocketInstance?.write).toHaveBeenCalledWith(
			`password ${escapeArg(password)}\n`,
			"utf8",
		);

		await expect(connectPromise).resolves.toBeInstanceOf(Connection);

		const connection = await connectPromise;
		connection.disconnect();
	});

	it("Connection.connect(): should reject if socket emits error during connect", async () => {
		const error = new Error("Connection refused");
		const connectPromise = Connection.connect(options);

		mockSocketInstance?.simulateError(error);

		await expect(connectPromise).rejects.toThrow(error);
	});

	it("Connection.connect(): should reject if connection closes before handshake", async () => {
		const connectPromise = Connection.connect(options);

		mockSocketInstance?.simulateClose();

		await expect(connectPromise).rejects.toThrow(
			"Connection closed before MPD welcome message.",
		);
	});

	it("sendCommand(): should write command and return stream on OK", async () => {
		const connectPromise = Connection.connect(options);

		mockSocketInstance?.simulateData(`${OK} MPD 0.23.5\n`);
		const connection = await connectPromise;
		(mockSocketInstance?.write as jest.Mock)?.mockClear();

		const cmd = "status";
		const streamPromise = connection.executeCommand(cmd);

		expect(mockSocketInstance?.write).toHaveBeenCalledWith(
			`${cmd}\n`,
			"utf8",
			expect.any(Function),
		);

		mockSocketInstance?.simulateData("volume: 80\n");
		const stream = await streamPromise;
		const reader = stream.getReader();
		await expect(reader.read()).resolves.toEqual({
			done: false,
			value: { raw: "volume: 80" },
		});

		mockSocketInstance?.simulateData("state: play\n");
		await expect(reader.read()).resolves.toEqual({
			done: false,
			value: { raw: "state: play" },
		});

		mockSocketInstance?.simulateData(`${OK}\n`);
		await expect(reader.read()).resolves.toEqual({
			done: true,
			value: undefined,
		});

		connection.disconnect();
	});

	it("sendCommand(): should reject on ACK", async () => {
		const connectPromise = Connection.connect(options);

		mockSocketInstance?.simulateData(`${OK} MPD 0.23.5\n`);
		const connection = await connectPromise;
		(mockSocketInstance?.write as jest.Mock)?.mockClear();

		const cmd = "badcommand";
		const errorMsg = `${ACK_PREFIX} [50@0] {${cmd}} unknown command "${cmd}"`;
		const streamPromise = connection.executeCommand(cmd);

		expect(mockSocketInstance?.write).toHaveBeenCalledWith(
			`${cmd}\n`,
			"utf8",
			expect.any(Function),
		);
		mockSocketInstance?.simulateData(`${errorMsg}\n`);

		const stream = await streamPromise;
		const reader = stream.getReader();
		await expect(reader.read()).rejects.toThrow(MpdError);

		connection.disconnect();
	});

	it("disconnect(): should call socket.end()", async () => {
		const connectPromise = Connection.connect(options);
		mockSocketInstance?.simulateData(`${OK} MPD 0.23.5\n`);
		const connection = await connectPromise;

		connection.disconnect();
		expect(mockSocketInstance?.end).toHaveBeenCalledTimes(1);
	});
});

describe("ConnectionPool", () => {
	const poolOptions: Config & { poolSize: number } = {
		host: "poolhost",
		port: 6601,
		poolSize: 2,
	};

	beforeEach(() => {
		jest.clearAllMocks();
		activeMockSockets = []; // Clear tracked sockets before each pool test
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("should create a pool instance", () => {
		const pool = new ConnectionPool(poolOptions);
		expect(pool).toBeInstanceOf(ConnectionPool);
		// @ts-expect-error
		expect(pool.config.host).toBe(poolOptions.host);
		// @ts-expect-error
		expect(pool.config.port).toBe(poolOptions.port);
		// @ts-expect-error
		expect(pool.config.poolSize).toBe(poolOptions.poolSize);
	});

	// Helper to simulate handshake for a specific connection/socket index
	const simulateHandshake = async (socketIndex: number) => {
		const socket = activeMockSockets[socketIndex];
		if (socket) {
			socket.simulateData(`${OK} MPD 0.23.5\n`);
		} else {
			throw new Error(`Mock socket at index ${socketIndex} not found`);
		}
	};

	it("getConnection(): should return a real Connection instance (using mock socket)", async () => {
		const pool = new ConnectionPool(poolOptions);
		const connPromise = pool.getConnection();
		await simulateHandshake(0);
		const conn = await connPromise;

		expect(conn).toBeInstanceOf(Connection);
		expect(net.createConnection).toHaveBeenCalledTimes(1);
		expect(conn.isBusy()).toBe(true);

		await pool.releaseConnection(conn);
	});

	it("releaseConnection(): should mark connection as not busy", async () => {
		const pool = new ConnectionPool(poolOptions);
		const connPromise = pool.getConnection();
		await simulateHandshake(0);
		const conn = await connPromise;

		expect(conn.isBusy()).toBe(true);

		await pool.releaseConnection(conn);
		expect(conn.isBusy()).toBe(false);
	});

	it("getConnection(): should reuse released connections", async () => {
		const pool = new ConnectionPool(poolOptions);
		const conn1Promise = pool.getConnection();
		await simulateHandshake(0);
		const conn1 = await conn1Promise;
		await pool.releaseConnection(conn1);

		const createConnectionCalls = (net.createConnection as jest.Mock).mock.calls
			.length;

		const conn2Promise = pool.getConnection();
		expect(net.createConnection).toHaveBeenCalledTimes(createConnectionCalls);
		const conn2 = await conn2Promise;
		expect(conn2).toBe(conn1);
		expect(conn2.isBusy()).toBe(true);

		await pool.releaseConnection(conn2);
	});

	it("getConnection(): should create new connection if pool is not full", async () => {
		const pool = new ConnectionPool(poolOptions);
		const conn1Promise = pool.getConnection();
		await simulateHandshake(0);
		const conn1 = await conn1Promise;

		const conn2Promise = pool.getConnection();
		await simulateHandshake(1);
		const conn2 = await conn2Promise;

		expect(net.createConnection).toHaveBeenCalledTimes(2);
		expect(conn1).not.toBe(conn2);
		expect(conn1.isBusy()).toBe(true);
		expect(conn2.isBusy()).toBe(true);

		await pool.releaseConnection(conn1);
		await pool.releaseConnection(conn2);
	});

	it("getConnection(): should throw error if pool is full and all connections are busy", async () => {
		const pool = new ConnectionPool(poolOptions);
		const conn1Promise = pool.getConnection();
		const conn2Promise = pool.getConnection();
		await simulateHandshake(0);
		await simulateHandshake(1);
		const conn1 = await conn1Promise;
		const conn2 = await conn2Promise;

		expect(conn1.isBusy()).toBe(true);
		expect(conn2.isBusy()).toBe(true);

		await expect(pool.getConnection()).rejects.toThrow(
			"Failed to get connection: pool is full and all connections are busy.",
		);
	});

	it("disconnectAll(): should disconnect all connections", async () => {
		const pool = new ConnectionPool(poolOptions);
		const conn1Promise = pool.getConnection();
		const conn2Promise = pool.getConnection();
		await simulateHandshake(0);
		await simulateHandshake(1);
		await conn1Promise;
		await conn2Promise;

		await pool.disconnectAll();

		expect(activeMockSockets[0]?.end).toHaveBeenCalledTimes(1);
		expect(activeMockSockets[1]?.end).toHaveBeenCalledTimes(1);
		expect(pool.getAvailableCount()).toBe(poolOptions.poolSize);
	});
});
