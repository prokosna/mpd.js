import { CommandQueue } from "../lib/queue";
import { ConnectionPool } from "../lib/connection";
import type { Connection } from "../lib/connection";
import { Command } from "../lib/command";
import { ReadableStream } from "node:stream/web";
import type { ResponseLine } from "../lib/types";
import { beforeEach, describe, expect, it, type Mocked, vi } from "vitest";

const mockExecuteCommand =
	vi.fn<(command: string | Command) => Promise<ReadableStream<ResponseLine>>>();
const mockExecuteCommands =
	vi.fn<
		(commands: (string | Command)[]) => Promise<ReadableStream<ResponseLine>>
	>();
const mockIsConnected = vi.fn<() => boolean>().mockReturnValue(true);

const mockConnection = {
	executeCommand: mockExecuteCommand,
	executeCommands: mockExecuteCommands,
	isConnected: mockIsConnected,
} as unknown as Mocked<Connection>;

const mockGetConnection = vi.fn<() => Promise<Connection>>();
const mockGetAvailableCount = vi.fn<() => number>();
const mockReleaseConnection = vi.fn<(connection: Connection) => void>();
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockEmit = vi.fn();

vi.mock("../lib/connection", () => {
	return {
		ConnectionPool: vi.fn().mockImplementation((config) => {
			return {
				getConnection: mockGetConnection,
				getAvailableCount: mockGetAvailableCount,
				releaseConnection: mockReleaseConnection,
				on: mockOn,
				off: mockOff,
				emit: mockEmit,
				config: config,
			};
		}),
	};
});

const yieldExecution = () => new Promise((resolve) => setImmediate(resolve));

describe("CommandQueue Unit Tests", () => {
	let commandQueue: CommandQueue;
	let mockPoolInstance: Mocked<ConnectionPool>;

	beforeEach(() => {
		vi.clearAllMocks();

		mockGetConnection.mockResolvedValue(mockConnection);
		mockGetAvailableCount.mockReturnValue(1);
		const emptyStream = new ReadableStream<ResponseLine>();
		mockExecuteCommand.mockResolvedValue(emptyStream);
		mockExecuteCommands.mockResolvedValue(emptyStream);

		const mockConfig = { host: "mockhost", port: 6600 };
		mockPoolInstance = new ConnectionPool(mockConfig) as Mocked<ConnectionPool>;
		commandQueue = new CommandQueue(mockPoolInstance);
	});

	describe("Processing Queue", () => {
		it("should request a connection when a command is enqueued and queue was empty", async () => {
			commandQueue.enqueue("status");
			await yieldExecution();

			expect(mockGetAvailableCount).toHaveBeenCalled();
			expect(mockGetConnection).toHaveBeenCalledTimes(1);
		});

		it("should not request a connection if none are available", async () => {
			mockGetAvailableCount.mockReturnValue(0);

			commandQueue.enqueue("status");
			await yieldExecution();

			expect(mockGetAvailableCount).toHaveBeenCalled();
			expect(mockGetConnection).not.toHaveBeenCalled();
		});

		it("should send the command using the obtained connection", async () => {
			const cmd = new Command("status");
			commandQueue.enqueue(cmd);
			await yieldExecution();

			expect(mockGetConnection).toHaveBeenCalledTimes(1);
			expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
			expect(mockExecuteCommand).toHaveBeenCalledWith(cmd);
		});

		it("should send multiple commands using sendCommands", async () => {
			const commands = [new Command("play"), new Command("pause")];
			commandQueue.enqueue(commands);
			await yieldExecution();

			expect(mockGetConnection).toHaveBeenCalledTimes(1);
			expect(mockExecuteCommands).toHaveBeenCalledTimes(1);
			expect(mockExecuteCommands).toHaveBeenCalledWith(commands);
			expect(mockExecuteCommand).not.toHaveBeenCalled();
		});

		it("should resolve the promise and release connection when sendCommand succeeds", async () => {
			const mockSuccessResponse = new ReadableStream<ResponseLine>();
			mockExecuteCommand.mockResolvedValue(mockSuccessResponse);

			const enqueuePromise = commandQueue.enqueue("status");
			await yieldExecution();

			await expect(enqueuePromise).resolves.toBe(mockSuccessResponse);
			await yieldExecution();
			expect(mockReleaseConnection).toHaveBeenCalledTimes(1);
			expect(mockReleaseConnection).toHaveBeenCalledWith(mockConnection);
		});

		it("should reject the promise and release connection when sendCommand fails", async () => {
			const mockError = new Error("MPD command error");
			mockExecuteCommand.mockImplementation(() => {
				throw mockError;
			});

			const enqueuePromise = commandQueue.enqueue("status");
			await expect(enqueuePromise).rejects.toThrow(mockError);

			await yieldExecution();
			expect(mockReleaseConnection).toHaveBeenCalledTimes(1);
			expect(mockReleaseConnection).toHaveBeenCalledWith(mockConnection);

			mockExecuteCommand.mockResolvedValue(new ReadableStream<ResponseLine>());
		});

		it("should reject the promise and not release connection if getConnection fails", async () => {
			const mockGetConnectionError = new Error("Pool is full");
			mockGetConnection.mockRejectedValue(mockGetConnectionError);

			const enqueuePromise = commandQueue.enqueue("status");

			await expect(enqueuePromise).rejects.toThrow(mockGetConnectionError);
			expect(mockReleaseConnection).not.toHaveBeenCalled();

			mockGetConnection.mockResolvedValue(mockConnection);
		});

		it("should process commands based on priority", async () => {
			const lowCmd = new Command("listallinfo");
			const midCmd = new Command("status");
			const highCmd = new Command("ping");

			mockExecuteCommand.mockResolvedValue(new ReadableStream<ResponseLine>());
			mockExecuteCommands.mockResolvedValue(new ReadableStream<ResponseLine>());

			const pMid = commandQueue.enqueue(midCmd, 5);
			const pLow = commandQueue.enqueue(lowCmd, 1);
			const pHigh = commandQueue.enqueue(highCmd, 10);

			await Promise.all([pMid, pLow, pHigh]);

			expect(mockExecuteCommand).toHaveBeenCalledTimes(3);

			const calls = mockExecuteCommand.mock.calls;
			expect(calls[0][0]).toBe(highCmd);
			expect(calls[1][0]).toBe(midCmd);
			expect(calls[2][0]).toBe(lowCmd);

			expect(mockReleaseConnection).toHaveBeenCalledTimes(3);
		});
	});
});
