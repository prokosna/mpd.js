import type { Socket } from "node:net";
import { createConnection } from "node:net";
import { ReadableStream } from "node:stream/web";
import { StringDecoder } from "node:string_decoder";
import type { Command } from "./command.js";
import type { Config } from "./client.js";
import { MpdError } from "./error.js";
import {
	ACK_PREFIX,
	BINARY_HEADER_REGEX,
	OK,
	PACKAGE_NAME,
	EVENT_CONNECTION_AVAILABLE,
} from "./const.js";
import debugCreator from "debug";
import type { ResponseLine } from "./types.js";
import { EventEmitter } from "node:events";
import { escapeArg } from "./parserUtils.js";
import { randomUUID } from "node:crypto";

const debug = debugCreator(`${PACKAGE_NAME}:connection`);

/**
 * Represents a single connection to an MPD server.
 * Manages the socket connection, command execution, and response parsing.
 */
export class Connection extends EventEmitter {
	private readonly id: string;
	readonly socket: Socket;
	private readonly mpdVersion: string;
	private busy: boolean;
	private isExecutingCommand: boolean;
	private readonly COMMAND_EXECUTION_FINISHED = "COMMAND_EXECUTION_FINISHED";

	private constructor(id: string, socket: Socket, mpdVersion: string) {
		super();
		this.id = id;
		this.socket = socket;
		this.mpdVersion = mpdVersion;
		this.busy = false;
		this.isExecutingCommand = false;
	}

	/**
	 * Establishes a connection to the MPD server.
	 * Performs the initial handshake and optional password authentication.
	 * @param config - Connection configuration options.
	 * @param id - Optional ID for the connection. If not provided, a random UUID will be generated.
	 * @returns A promise that resolves with a new Connection instance upon successful handshake.
	 */
	static connect(
		config: Config,
		id: string = randomUUID(),
	): Promise<Connection> {
		return new Promise((resolve, reject) => {
			const socket = createConnection(config);
			let version = "";

			const timer = setTimeout(() => {
				socket.destroy(
					new Error(`Connection timed out after ${config.timeout || 5000}ms`),
				);
			}, config.timeout || 5000);

			socket.once("connect", () => {});

			socket.once("data", (data) => {
				const message = data.toString("utf8");
				if (message.startsWith("OK MPD ")) {
					version = message.substring("OK MPD ".length).trim();
					clearTimeout(timer);

					if (config.password !== undefined) {
						debug("Sending password...");
						socket.once("data", (data2) => {
							const message2 = data2.toString("utf8");
							if (message2.startsWith(OK)) {
								socket.removeAllListeners("error");
								socket.removeAllListeners("close");
								resolve(new Connection(id, socket, version));
								return;
							}
							socket.destroy(
								new Error(`Failed to authenticate with password: ${message2}`),
							);
						});
						socket.write(`password ${escapeArg(config.password)}\n`, "utf8");
						return;
					}

					// No password
					socket.removeAllListeners("error");
					socket.removeAllListeners("close");
					resolve(new Connection(id, socket, version));
				} else {
					socket.destroy(
						new Error(`Unexpected response from server: ${message}`),
					);
				}
			});

			socket.once("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});

			socket.once("close", (hadError) => {
				clearTimeout(timer);
				reject(new Error("Connection closed before MPD welcome message."));
			});
		});
	}

	/**
	 * Disconnects from the MPD server gracefully.
	 * @returns A promise that resolves when the socket is closed.
	 */
	disconnect(): Promise<void> {
		return new Promise((resolve, _reject) => {
			if (this.socket.destroyed) {
				resolve();
				return;
			}
			this.socket.once("close", () => resolve());
			this.socket.once("error", (err) => {
				console.error(`Error during socket disconnection: ${err}`);
			});
			this.socket.end();
		});
	}

	/**
	 * Executes a single MPD command and streams the response lines.
	 * Handles response parsing, including binary data, and detects command termination (OK or ACK).
	 * @param command - The command string or Command object to execute.
	 * @returns A ReadableStream that yields response lines until the command completes or fails.
	 */
	executeCommand(command: string | Command): ReadableStream<ResponseLine> {
		this.isExecutingCommand = true;
		const commandStr = `${command}\n`;
		let buffer = "";
		const decoder = new StringDecoder("utf8");
		let isCleanedUp = false;

		const stream = new ReadableStream<ResponseLine>({
			start: (controller) => {
				debug(`Executing command: ${commandStr.trim()}`);

				const cleanupListeners = () => {
					if (isCleanedUp) return;
					isCleanedUp = true;
					this.socket.off("data", dataListener);
					this.socket.off("error", errorListener);
					this.socket.off("close", closeListener);
					const remaining = decoder.end();
					if (remaining) {
						debug(
							`StringDecoder flushed remaining bytes during cleanup: ${remaining}`,
						);
					}
				};

				let mode: "text" | "binary" = "text";
				let expectedBinaryBytes = 0;
				let receivedBinaryBytes = 0;
				let binaryBufferAccumulator: Buffer[] = [];
				let pendingBinaryLine: ResponseLine | undefined = undefined;

				const enqueueRegularTextLine = (rawLine: string) => {
					const line: ResponseLine = { raw: rawLine };

					if (rawLine === OK) {
						debug("Command successful (OK)");
						cleanupListeners();
						controller.close();
						this.isExecutingCommand = false;
						this.emit(this.COMMAND_EXECUTION_FINISHED);
					} else if (rawLine.startsWith(ACK_PREFIX)) {
						debug(`Command failed (ACK): ${rawLine}`);
						const error = new MpdError(rawLine);
						cleanupListeners();
						controller.error(error);
						this.isExecutingCommand = false;
						this.emit(this.COMMAND_EXECUTION_FINISHED);
					} else {
						controller.enqueue(line);
					}
				};

				const dataListener = (data: Buffer) => {
					if (isCleanedUp) return;

					let remainingChunk = data;

					while (remainingChunk.length > 0 && !isCleanedUp) {
						if (mode === "binary") {
							const bytesNeeded = expectedBinaryBytes - receivedBinaryBytes;
							const bytesToProcess = Math.min(
								remainingChunk.length,
								bytesNeeded,
							);
							const binaryChunk = remainingChunk.subarray(0, bytesToProcess);

							binaryBufferAccumulator.push(binaryChunk);
							receivedBinaryBytes += bytesToProcess;
							remainingChunk = remainingChunk.subarray(bytesToProcess);

							if (receivedBinaryBytes === expectedBinaryBytes) {
								if (pendingBinaryLine) {
									pendingBinaryLine.binaryData = Buffer.concat(
										binaryBufferAccumulator,
									);
									controller.enqueue(pendingBinaryLine);
								} else {
									console.error(
										"Error: pendingBinaryLine was null when binary data finished.",
									);
								}

								mode = "text";
								expectedBinaryBytes = 0;
								receivedBinaryBytes = 0;
								binaryBufferAccumulator = [];
								pendingBinaryLine = undefined;
							} else {
								// Binary not finished, consumed the whole remainingChunk for now
								break;
							}
						} else {
							buffer += decoder.write(remainingChunk);
							remainingChunk = Buffer.alloc(0);

							while (mode === "text" && !isCleanedUp) {
								const newlineIndex = buffer.indexOf("\n");
								if (newlineIndex === -1) break;

								const rawLine = buffer.substring(0, newlineIndex);
								buffer = buffer.substring(newlineIndex + 1);

								const binaryMatch = rawLine.match(BINARY_HEADER_REGEX);
								if (binaryMatch) {
									const length = Number.parseInt(binaryMatch[1], 10);
									if (!Number.isNaN(length) && length >= 0) {
										pendingBinaryLine = { raw: rawLine };

										if (length === 0) {
											// Handle zero-length binary immediately
											pendingBinaryLine.binaryData = Buffer.alloc(0);
											controller.enqueue(pendingBinaryLine);
											debug("Received zero-length binary data.");
											pendingBinaryLine = null;
										} else {
											// Switch to binary mode
											mode = "binary";
											expectedBinaryBytes = length;
											receivedBinaryBytes = 0;
											binaryBufferAccumulator = [];
											break;
										}
									} else {
										console.warn(`Invalid binary length in line: ${rawLine}`);
										enqueueRegularTextLine(rawLine);
									}
								} else {
									enqueueRegularTextLine(rawLine);
								}
							}
						}
					}
				};

				const errorListener = (err: Error) => {
					if (isCleanedUp) return;
					debug(`Socket error during command execution: ${err.message}`);
					controller.error(err);
					cleanupListeners();
				};

				const closeListener = (hadError: boolean) => {
					if (isCleanedUp) {
						debug("Socket closed, stream already handled.");
						return;
					}
					if (hadError) {
						debug("Socket closed with error");
						controller.error(
							new Error("Socket closed unexpectedly with error"),
						);
					} else {
						debug("Socket closed unexpectedly");
						controller.error(new Error("Socket closed unexpectedly"));
					}
					cleanupListeners();
				};

				// Attach listeners
				this.socket.on("data", dataListener);
				this.socket.on("error", errorListener);
				this.socket.on("close", closeListener);

				// Send command
				this.socket.write(commandStr, "utf8", (err) => {
					if (err) {
						debug(`Error writing command to socket: ${err.message}`);
						controller.error(err);
						cleanupListeners();
					}
				});
			},
			cancel: (reason) => {
				debug(`Stream cancelled: ${reason}`);
			},
		});

		return stream;
	}

	/**
	 * Executes a list of MPD commands atomically using command_list_ok_begin/end.
	 * @param commands - An array of command strings or Command objects.
	 * @returns A ReadableStream that yields response lines for the entire list.
	 */
	executeCommands(
		commands: (string | Command)[],
	): ReadableStream<ResponseLine> {
		const cmd = `command_list_ok_begin\n${commands.join("\n")}\ncommand_list_end`;
		return this.executeCommand(cmd);
	}

	/**
	 * Checks if the connection is currently busy executing a command.
	 * @returns True if busy, false otherwise.
	 */
	isBusy(): boolean {
		return this.busy;
	}

	/**
	 * Sets the busy state of the connection.
	 * @internal Used by the connection pool.
	 * @param busy - The new busy state.
	 */
	setBusy(busy: boolean): void {
		this.busy = busy;
	}

	/**
	 * Gets the MPD protocol version reported by the server upon connection.
	 * @returns The MPD version string.
	 */
	getMpdVersion(): string {
		return this.mpdVersion;
	}

	/**
	 * Gets the connection ID.
	 * @returns The connection ID.
	 */
	getId(): string {
		return this.id;
	}

	/**
	 * Checks if the socket is destroyed.
	 * @returns True if the socket is destroyed, false otherwise.
	 */
	isSocketDestroyed(): boolean {
		return this.socket.destroyed;
	}

	/**
	 * Waits for the current command execution to finish.
	 * @returns A promise that resolves when the current command execution is finished.
	 */
	waitForCommandExecutionFinished(): Promise<void> {
		return new Promise((resolve) => {
			if (!this.isExecutingCommand) {
				resolve();
				return;
			}
			this.once(this.COMMAND_EXECUTION_FINISHED, resolve);
		});
	}
}

/**
 * Manages a pool of reusable connections to the MPD server,
 * optimizing resource usage for sending commands.
 * Handles acquiring and releasing connections.
 */
export class ConnectionPool extends EventEmitter {
	private connectionPromises: Map<string, Promise<Connection>>;
	private connections: Map<string, Connection>;
	private config: Config;

	/**
	 * Creates a new ConnectionPool.
	 * @param config - Connection configuration options, including poolSize.
	 */
	constructor(config: Config) {
		super();
		this.connections = new Map();
		this.connectionPromises = new Map();
		this.config = config;
	}

	/**
	 * Releases a connection back to the pool, marking it as not busy.
	 * Emits 'connectionAvailable' event.
	 * @param connection - The connection to release.
	 */
	async releaseConnection(connection: Connection): Promise<void> {
		for (const [key, c] of this.connections.entries()) {
			if (c === connection) {
				if (connection.isBusy()) {
					await connection.waitForCommandExecutionFinished();
					debug(`Releasing connection: ${key}`);
					connection.setBusy(false);
					this.emit(EVENT_CONNECTION_AVAILABLE);
				} else {
					throw new Error(
						`Attempted to release connection ${key} which was not busy.`,
					);
				}
				return;
			}
		}
		throw new Error(
			`Attempted to release connection ${connection.getId()} which is not managed by this pool.`,
		);
	}

	/**
	 * Disconnects all connections currently in the pool.
	 * @returns A promise that resolves when all disconnections are attempted.
	 */
	async disconnectAll(): Promise<void> {
		const disconnectPromises = Array.from(this.connections.entries()).map(
			([key, connection]) => {
				this.connectionPromises.delete(key);
				return connection.disconnect().catch((error) => {
					console.error(`Error disconnecting connection: ${error}`);
				});
			},
		);
		for (const [key, connectionPromise] of this.connectionPromises) {
			console.warn(
				`Connection ${key} is still being created when disconnectAll was called.`,
			);
			disconnectPromises.push(
				connectionPromise.then((connection) =>
					connection.disconnect().catch((error) => {
						console.error(`Error disconnecting connection: ${error}`);
					}),
				),
			);
		}
		await Promise.allSettled(disconnectPromises);
		this.connections = new Map();
		this.connectionPromises = new Map();
	}

	/**
	 * Creates a new, dedicated connection to the MPD server, outside of the pool management.
	 * @param id - The ID for the connection.
	 * @returns A promise that resolves with the new Connection instance.
	 */
	async createDedicatedConnection(
		id: string = randomUUID(),
	): Promise<Connection> {
		try {
			return Connection.connect(this.config, id);
		} catch (error) {
			console.error("Failed to create dedicated connection:", error);
			throw error;
		}
	}

	/**
	 * Acquires a connection from the pool for command execution.
	 * Reuses an idle connection if available, creates a new one if the pool is not full,
	 * or throws an error if the pool is exhausted.
	 * Marks the acquired connection as busy.
	 * @returns A promise that resolves with an available Connection instance ready for use.
	 */
	async getConnection(): Promise<Connection> {
		// 0. Check if there are any destroyed connections.
		for (const [key, connection] of this.connections.entries()) {
			if (connection.isSocketDestroyed()) {
				this.connections.delete(key);
				this.connectionPromises.delete(key);
			}
		}

		// 1. Find an idle connection in the pool
		for (const connection of this.connections.values()) {
			if (!connection.isBusy()) {
				connection.setBusy(true);
				return connection;
			}
		}

		// 2. If no idle connection and pool is not full, create a new one
		if (this.connectionPromises.size < this.config.poolSize) {
			debug(
				`No idle connection found, creating new one (pool size ${this.connectionPromises.size}/${this.config.poolSize}).`,
			);
			const id = randomUUID();
			const newConnectionPromise = this.createDedicatedConnection(id);
			this.connectionPromises.set(id, newConnectionPromise);
			return newConnectionPromise
				.then((newConnection) => {
					this.connections.set(id, newConnection);
					newConnection.setBusy(true);
					// Add a listener to remove connection from pool if it closes unexpectedly
					newConnection.socket.once("close", () => {
						console.warn("Connection closed unexpectedly, removing from pool.");
						this.connectionPromises.delete(id);
						this.connections.delete(id);
					});
					debug(
						`New connection created (pool size ${this.connections.size}/${this.config.poolSize}).`,
					);
					return newConnection;
				})
				.catch((err) => {
					throw new Error(`Failed to create new connection: ${err}`);
				});
		}

		// 3. If pool is full and all connections are busy, wait for a connection to become available
		return new Promise((resolve) => {
			this.once(EVENT_CONNECTION_AVAILABLE, () => {
				resolve(this.getConnection());
			});
		});
	}
}
