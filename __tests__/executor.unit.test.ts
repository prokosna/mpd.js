import { CommandExecutor } from "../lib/executor";
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
const mockReleaseConnection = vi.fn<(connection: Connection) => void>();
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockEmit = vi.fn();

vi.mock("../lib/connection", () => {
	return {
		ConnectionPool: vi.fn().mockImplementation((config) => {
			return {
				getConnection: mockGetConnection,
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
	let commandQueue: CommandExecutor;
	let mockPoolInstance: Mocked<ConnectionPool>;

	beforeEach(() => {
		vi.clearAllMocks();

		mockGetConnection.mockResolvedValue(mockConnection);
		const emptyStream = new ReadableStream<ResponseLine>();
		mockExecuteCommand.mockResolvedValue(emptyStream);
		mockExecuteCommands.mockResolvedValue(emptyStream);

		const mockConfig = { host: "mockhost", port: 6600 };
		mockPoolInstance = new ConnectionPool(mockConfig) as Mocked<ConnectionPool>;
		commandQueue = new CommandExecutor(mockPoolInstance);
	});

	describe("Processing Queue", () => {
		it("should request a connection when a command is executed and pool is empty", async () => {
			commandQueue.execute("status");
			await yieldExecution();

			expect(mockGetConnection).toHaveBeenCalledTimes(1);
		});

		it("should send the command using the obtained connection", async () => {
			const cmd = new Command("status");
			commandQueue.execute(cmd);
			await yieldExecution();

			expect(mockGetConnection).toHaveBeenCalledTimes(1);
			expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
			expect(mockExecuteCommand).toHaveBeenCalledWith(cmd);
		});

		it("should send multiple commands using sendCommands", async () => {
			const commands = [new Command("play"), new Command("pause")];
			commandQueue.execute(commands);
			await yieldExecution();

			expect(mockGetConnection).toHaveBeenCalledTimes(1);
			expect(mockExecuteCommands).toHaveBeenCalledTimes(1);
			expect(mockExecuteCommands).toHaveBeenCalledWith(commands);
			expect(mockExecuteCommand).not.toHaveBeenCalled();
		});

		it("should resolve the promise and release connection when sendCommand succeeds", async () => {
			const mockSuccessResponse = new ReadableStream<ResponseLine>();
			mockExecuteCommand.mockResolvedValue(mockSuccessResponse);

			const enqueuePromise = commandQueue.execute("status");
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

			const enqueuePromise = commandQueue.execute("status");
			await expect(enqueuePromise).rejects.toThrow(mockError);

			await yieldExecution();
			expect(mockReleaseConnection).toHaveBeenCalledTimes(1);
			expect(mockReleaseConnection).toHaveBeenCalledWith(mockConnection);

			mockExecuteCommand.mockResolvedValue(new ReadableStream<ResponseLine>());
		});

		it("should reject the promise and not release connection if getConnection fails", async () => {
			const mockGetConnectionError = new Error("Pool is full");
			mockGetConnection.mockRejectedValue(mockGetConnectionError);

			const enqueuePromise = commandQueue.execute("status");

			await expect(enqueuePromise).rejects.toThrow(mockGetConnectionError);
			expect(mockReleaseConnection).not.toHaveBeenCalled();

			mockGetConnection.mockResolvedValue(mockConnection);
		});
	});
});
