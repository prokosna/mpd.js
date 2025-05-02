import { EventEmitter } from "node:events";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NetConnectOpts, Socket } from "node:net";
import { OK, ACK_PREFIX } from "../lib/const";
import { Connection } from "../lib/connection";
import { escapeArg } from "../lib/parserUtils";
import { MpdError } from "../lib/error";

// --- Mock Socket Implementation ---
class SimpleMockSocket extends EventEmitter {
	connect = vi.fn().mockImplementation((_opts, callback) => {
		process.nextTick(() => {
			this.emit("connect");
			if (callback) callback();
		});
		return this;
	});
	write = vi.fn();
	end = vi.fn().mockImplementation(() => {
		process.nextTick(() => this.emit("close"));
		return this;
	});
	destroy = vi.fn().mockImplementation((err?: Error) => {
		if (err) {
			// Ensure error emits *before* close if an error is passed
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
	removeAllListeners = vi.fn(() => this);
	ref = vi.fn(() => this);
	unref = vi.fn(() => this);
	once = vi.fn().mockImplementation((event, listener) => {
		super.once(event, listener);
		return this;
	});
}

let lastCreatedSocket: SimpleMockSocket | null = null;

// --- Hoisted Mock ---
const mocks = vi.hoisted(() => {
	const mockCreateConnectionFn = (config: NetConnectOpts): Socket => {
		const socket = new SimpleMockSocket();
		lastCreatedSocket = socket;
		process.nextTick(() => socket.emit("connect"));
		return socket as unknown as Socket;
	};
	return {
		mockCreateConnection: vi.fn(mockCreateConnectionFn),
	};
});

// --- Mock 'node:net' ---
vi.mock("node:net", () => {
	return {
		__esModule: true,
		createConnection: mocks.mockCreateConnection,
	};
});

describe("Connection (Expanded Mock Tests)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		lastCreatedSocket = null;
		vi.useRealTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should connect, handle handshake, and resolve", async () => {
		const connectPromise = Connection.connect({
			host: "localhost",
			port: 6600,
		});

		expect(mocks.mockCreateConnection).toHaveBeenCalledTimes(1);
		expect(mocks.mockCreateConnection).toHaveBeenCalledWith({
			host: "localhost",
			port: 6600,
		});
		expect(lastCreatedSocket).toBeInstanceOf(SimpleMockSocket);
		if (!lastCreatedSocket) throw new Error("Socket mock not created");

		lastCreatedSocket.simulateData(`${OK} MPD 0.23.5\n`);
		const connection = await connectPromise;

		expect(connection).toBeInstanceOf(Connection);
		expect(connection.getMpdVersion()).toBe("0.23.5");
		expect(lastCreatedSocket.removeAllListeners).toHaveBeenCalledWith("error");
		expect(lastCreatedSocket.removeAllListeners).toHaveBeenCalledWith("close");
	});

	it("should connect with password successfully", async () => {
		const config = { host: "localhost", port: 6600, password: "testPassword" };
		const connectPromise = Connection.connect(config);

		expect(mocks.mockCreateConnection).toHaveBeenCalledTimes(1);
		expect(lastCreatedSocket).toBeInstanceOf(SimpleMockSocket);
		if (!lastCreatedSocket) throw new Error("Socket mock not created");

		lastCreatedSocket.simulateData(`${OK} MPD 0.23.5\n`);
		await Promise.resolve();

		expect(lastCreatedSocket.write).toHaveBeenCalledTimes(1);
		expect(lastCreatedSocket.write).toHaveBeenCalledWith(
			`password ${escapeArg(config.password)}\n`,
			"utf8",
		);

		lastCreatedSocket.simulateData(`${OK}\n`);
		const connection = await connectPromise;

		expect(connection).toBeInstanceOf(Connection);
		expect(connection.getMpdVersion()).toBe("0.23.5");
		expect(lastCreatedSocket.removeAllListeners).toHaveBeenCalledWith("error");
		expect(lastCreatedSocket.removeAllListeners).toHaveBeenCalledWith("close");
	});

	it("should reject if password authentication fails", async () => {
		const config = { host: "localhost", port: 6600, password: "wrongPassword" };
		const connectPromise = Connection.connect(config);

		expect(mocks.mockCreateConnection).toHaveBeenCalledTimes(1);
		expect(lastCreatedSocket).toBeInstanceOf(SimpleMockSocket);
		if (!lastCreatedSocket) throw new Error("Socket mock not created");

		lastCreatedSocket.simulateData(`${OK} MPD 0.23.5\n`);
		await Promise.resolve();

		expect(lastCreatedSocket.write).toHaveBeenCalledTimes(1);

		const errorMsg = "ACK [5@0] {password} incorrect password";
		lastCreatedSocket.simulateData(`${errorMsg}\n`);

		await Promise.resolve();
		await expect(connectPromise).rejects.toThrow(errorMsg.trim());
		expect(lastCreatedSocket.destroy).toHaveBeenCalled();
	});

	it("should reject if connection times out before handshake", async () => {
		vi.useFakeTimers();
		const timeoutMs = 150;
		const config = { host: "localhost", port: 6600, timeout: timeoutMs };
		const connectPromise = Connection.connect(config);

		expect(mocks.mockCreateConnection).toHaveBeenCalledTimes(1);
		expect(lastCreatedSocket).toBeInstanceOf(SimpleMockSocket);
		if (!lastCreatedSocket) throw new Error("Socket mock not created");

		vi.advanceTimersByTime(timeoutMs + 1);

		await expect(connectPromise).rejects.toThrow(
			`Connection timed out after ${timeoutMs}ms`,
		);
		expect(lastCreatedSocket.destroy).toHaveBeenCalledWith(expect.any(Error));
	});

	it("should clear timeout upon successful handshake", async () => {
		vi.useFakeTimers();
		const timeoutMs = 150;
		const config = { host: "localhost", port: 6600, timeout: timeoutMs };
		const connectPromise = Connection.connect(config);

		expect(mocks.mockCreateConnection).toHaveBeenCalledTimes(1);
		expect(lastCreatedSocket).toBeInstanceOf(SimpleMockSocket);
		if (!lastCreatedSocket) throw new Error("Socket mock not created");

		lastCreatedSocket.simulateData(`${OK} MPD 0.23.5\n`);
		const connection = await connectPromise;

		vi.advanceTimersByTime(timeoutMs + 1);

		expect(connection).toBeInstanceOf(Connection);
		expect(lastCreatedSocket.destroy).not.toHaveBeenCalled();
	});

	it("should reject if handshake response is invalid", async () => {
		const config = { host: "localhost", port: 6600 };
		const connectPromise = Connection.connect(config);

		expect(mocks.mockCreateConnection).toHaveBeenCalledTimes(1);
		expect(lastCreatedSocket).toBeInstanceOf(SimpleMockSocket);
		if (!lastCreatedSocket) throw new Error("Socket mock not created");

		const invalidResponse = "SOME UNEXPECTED RESPONSE\n";
		lastCreatedSocket.simulateData(invalidResponse);

		await expect(connectPromise).rejects.toThrow(
			`Unexpected response from server: ${invalidResponse.trim()}`,
		);
		expect(lastCreatedSocket.destroy).toHaveBeenCalledWith(expect.any(Error));
	});

	it("should reject if socket emits error before handshake data", async () => {
		const config = { host: "localhost", port: 6600 };
		const connectPromise = Connection.connect(config);

		expect(mocks.mockCreateConnection).toHaveBeenCalledTimes(1);
		expect(lastCreatedSocket).toBeInstanceOf(SimpleMockSocket);
		if (!lastCreatedSocket) throw new Error("Socket mock not created");

		const testError = new Error("ECONNREFUSED");
		lastCreatedSocket.simulateError(testError);

		await expect(connectPromise).rejects.toThrow(testError);
	});

	it("should reject if socket closes before handshake data", async () => {
		const config = { host: "localhost", port: 6600 };
		const connectPromise = Connection.connect(config);

		expect(mocks.mockCreateConnection).toHaveBeenCalledTimes(1);
		expect(lastCreatedSocket).toBeInstanceOf(SimpleMockSocket);
		if (!lastCreatedSocket) throw new Error("Socket mock not created");

		lastCreatedSocket.emit("close");

		await expect(connectPromise).rejects.toThrow(
			"Connection closed before MPD welcome message.",
		);
	});

	it("should disconnect correctly", async () => {
		const connectPromise = Connection.connect({
			host: "localhost",
			port: 6600,
		});
		expect(lastCreatedSocket).toBeInstanceOf(SimpleMockSocket);
		if (!lastCreatedSocket) throw new Error("Socket mock not created");

		lastCreatedSocket.simulateData(`${OK} MPD 0.23.5\n`);
		const connection = await connectPromise;

		await connection.disconnect();
		expect(lastCreatedSocket.end).toHaveBeenCalledTimes(1);
	});

	it("sendCommand(): should write command, return stream, and resolve on OK", async () => {
		const connectPromise = Connection.connect({
			host: "localhost",
			port: 6600,
		});
		expect(lastCreatedSocket).toBeInstanceOf(SimpleMockSocket);
		if (!lastCreatedSocket) throw new Error("Socket mock not created");

		lastCreatedSocket.simulateData(`${OK} MPD 0.23.5\n`);
		const connection = await connectPromise;

		const command = "status";
		const stream = connection.executeCommand(command);
		const reader = stream.getReader();

		expect(lastCreatedSocket.write).toHaveBeenCalledWith(
			`${command}\n`,
			"utf8",
			expect.any(Function),
		);

		lastCreatedSocket.simulateData("state: play\n");
		lastCreatedSocket.simulateData("song: 1\n");
		lastCreatedSocket.simulateData(`${OK}\n`);

		await expect(reader.read()).resolves.toEqual({
			done: false,
			value: { raw: "state: play" },
		});
		await expect(reader.read()).resolves.toEqual({
			done: false,
			value: { raw: "song: 1" },
		});
		await expect(reader.read()).resolves.toEqual({
			done: true,
			value: undefined,
		});
	});

	it("sendCommand(): should reject stream reading on ACK", async () => {
		const connectPromise = Connection.connect({
			host: "localhost",
			port: 6600,
		});
		expect(lastCreatedSocket).toBeInstanceOf(SimpleMockSocket);
		if (!lastCreatedSocket) throw new Error("Socket mock not created");

		lastCreatedSocket.simulateData(`${OK} MPD 0.23.5\n`);
		const connection = await connectPromise;

		const command = "invalid_command";
		const stream = connection.executeCommand(command);
		const reader = stream.getReader();

		expect(lastCreatedSocket.write).toHaveBeenCalledWith(
			`${command}\n`,
			"utf8",
			expect.any(Function),
		);

		const ackMsg = `${ACK_PREFIX} [5@0] {} unknown command "${command}"`;
		lastCreatedSocket.simulateData(`${ackMsg}\n`);

		await expect(reader.read()).rejects.toThrow(new MpdError(ackMsg));
	});
});
