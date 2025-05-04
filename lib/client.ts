import { EventEmitter } from "node:events";
import type { Command } from "./command.js";
import { ConnectionPool } from "./connection.js";
import { CommandExecutor } from "./executor.js";
import { EventManager } from "./event.js";
import type { ReadableStream } from "node:stream/web";
import type { ResponseLine } from "./types.js";
import { OK, PACKAGE_NAME } from "./const.js";
import debugCreator from "debug";
import { Parsers } from "./parsers.js";
import type * as net from "node:net";
import os from "node:os";

const debug = debugCreator(`${PACKAGE_NAME}:client`);

/**
 * Configuration options for the MPD client.
 * Inherits options from `net.NetConnectOpts`.
 */
export type Config = net.NetConnectOpts & {
	/** Size of the connection pool. Defaults to 3. */
	poolSize?: number;
	/** Delay in milliseconds before attempting to reconnect. Defaults to 5000. */
	reconnectDelay?: number;
	/** Maximum number of reconnection attempts. Defaults to 3. */
	maxRetries?: number;
	/** MPD server password. */
	password?: string;
};

/**
 * Applies default values to the configuration object if they are not set.
 * Reads defaults from environment variables (MPD_HOST, MPD_PORT, MPD_TIMEOUT)
 * or uses hardcoded values. Expands `~` in the path if provided.
 * @param config - The configuration object.
 * @returns The configuration object with defaults applied.
 */
function applyDefaultValuesIfNotSet(config: Config): Config {
	if ("path" in config) {
		if (config.path.startsWith("~")) {
			config.path = config.path.replace(/^~/, os.homedir());
		}
	} else {
		config.host ??= process.env.MPD_HOST || "localhost";
		config.port ??= Number(process.env.MPD_PORT) || 6600;
	}
	config.timeout ??= Number(process.env.MPD_TIMEOUT) || 5000;
	config.poolSize ??= 3;
	config.reconnectDelay ??= 5000;
	config.maxRetries ??= 3;
	return config;
}

/**
 * Main client class for interacting with an MPD server.
 * Manages connections, command queuing, and event handling.
 * Emits events based on MPD system updates (e.g., 'system-player').
 */
export class Client extends EventEmitter {
	private connectionPool: ConnectionPool;
	private commandExecutor: CommandExecutor;
	private eventManager: EventManager;
	private mpdVersion = "unknown";
	private totalListeners = 0;

	/**
	 * Private constructor. Use MpdClient.connect() to create instances.
	 * @param config - The client configuration.
	 */
	private constructor(config: Config) {
		super();
		this.connectionPool = new ConnectionPool(config);
		this.commandExecutor = new CommandExecutor(this.connectionPool);
		this.eventManager = new EventManager(this, this.connectionPool);

		this.on("newListener", async (event: string) => {
			if (!event.includes("system")) {
				return;
			}
			this.totalListeners++;
			if (this.totalListeners === 1) {
				await this.eventManager.startMonitoring();
				debug("Event monitoring started.");
			}
		});
	}

	/**
	 * Creates and connects an MpdClient instance.
	 * Initializes connection pool and command queue.
	 * @param config - The client configuration.
	 * @returns A promise that resolves with the connected MpdClient instance.
	 * @throws {Error} If the connection or initial setup fails.
	 */
	static async connect(config: Config): Promise<Client> {
		debug("Connecting...");
		const client = new Client(applyDefaultValuesIfNotSet(config));
		debug("Client instance created.");

		try {
			const connection =
				await client.connectionPool.createDedicatedConnection();
			client.mpdVersion = connection.getMpdVersion();
			debug(
				"Successfully connected to MPD server, version: %s",
				client.mpdVersion,
			);
			await connection.disconnect();
			return client;
		} catch (error) {
			debug("Connection error:", error);
			await client.disconnect();
			throw error;
		}
	}

	/**
	 * Sends a single command to the MPD server and aggregates the response to a string.
	 * @param command - The command string or Command object.
	 * @returns A promise that resolves with the full response string (including the final 'OK').
	 */
	async sendCommand(command: string | Command): Promise<string> {
		debug("Sending command: %o", command);
		return this.commandExecutor
			.execute(command)
			.then(Parsers.aggregateToString)
			.then((str) => [str, OK].filter(Boolean).join("\n"));
	}

	/**
	 * Sends multiple commands as a command list and aggregates the response to a string.
	 * @param commandList - An array of command strings or Command objects.
	 * @returns A promise that resolves with the full response string (including the final 'OK' or error).
	 */
	async sendCommands(commandList: (string | Command)[]): Promise<string> {
		debug("Sending commands: %o", commandList);
		return this.commandExecutor
			.execute(commandList)
			.then(Parsers.aggregateToString)
			.then((str) => [str, OK].filter(Boolean).join("\n"));
	}

	/**
	 * Sends a single command and returns the response as a ReadableStream.
	 * Each chunk in the stream corresponds to a ResponseLine.
	 * @param command - The command string or Command object.
	 * @returns A promise that resolves with a ReadableStream of ResponseLine objects.
	 */
	async streamCommand(
		command: string | Command,
	): Promise<ReadableStream<ResponseLine>> {
		debug("Streaming command: %o", command);
		return this.commandExecutor.execute(command);
	}

	/**
	 * Sends multiple commands as a command list and returns the response as a ReadableStream.
	 * Each chunk in the stream corresponds to a ResponseLine.
	 * @param commandList - An array of command strings or Command objects.
	 * @returns A promise that resolves with a ReadableStream of ResponseLine objects.
	 */
	async streamCommands(
		commandList: (string | Command)[],
	): Promise<ReadableStream<ResponseLine>> {
		debug("Streaming commands: %o", commandList);
		return this.commandExecutor.execute(commandList);
	}

	/**
	 * Disconnects the client, stopping event monitoring and closing all connections in the pool.
	 * Emits a 'close' event.
	 */
	async disconnect(): Promise<void> {
		debug("Disconnecting...");

		try {
			await this.eventManager.stopMonitoring();
			debug("Event monitoring stopped.");
		} catch (error) {
			debug("Error stopping event monitoring: %o", error);
		}

		try {
			await this.connectionPool.disconnectAll();
			debug("Connections disconnected.");
		} catch (error) {
			debug("Error disconnecting connections: %o", error);
		}

		this.emit("close");

		debug("Disconnected.");
	}

	/**
	 * Gets the MPD protocol version reported by the server upon connection.
	 */
	get PROTOCOL_VERSION(): string {
		return this.mpdVersion;
	}
}
