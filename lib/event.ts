import { EventEmitter } from "node:events";
import type { Connection, ConnectionPool } from "./connection.js";
import type { Config } from "./client.js";
import { ACK_PREFIX, CHANGED_EVENT_PREFIX, OK, PACKAGE_NAME } from "./const.js";
import debugCreator from "debug";
import { MpdError } from "./error.js";

const debug = debugCreator(`${PACKAGE_NAME}:event`);

/**
 * Manages the MPD idle connection for receiving real-time server events.
 * Uses a dedicated connection to avoid interfering with regular command execution.
 * Emits events through the provided emitter when MPD subsystems change.
 */
export class EventManager extends EventEmitter {
	private connection?: Connection;
	private idling: boolean;
	private emitter: EventEmitter;
	private connectionPool: ConnectionPool;
	private config: Config;
	private isMonitoring = false;
	private reconnectAttempts = 0;
	private reconnectTimer?: NodeJS.Timeout;
	private isReconnecting = false;

	/**
	 * Creates an instance of EventManager.
	 * @param emitter - The main EventEmitter of the MpdClient instance.
	 * @param connectionPool - The connection pool to acquire a dedicated connection from.
	 * @param config - Client configuration including reconnect settings.
	 */
	constructor(
		emitter: EventEmitter,
		connectionPool: ConnectionPool,
		config: Config,
	) {
		super();
		this.connection = undefined;
		this.idling = false;
		this.emitter = emitter;
		this.connectionPool = connectionPool;
		this.config = config;
	}

	/**
	 * Establishes a dedicated connection for monitoring MPD events and starts idling.
	 * Returns the MPD version upon successful connection.
	 * Rejects if monitoring is already active or fails to establish a connection.
	 * @returns A promise that resolves with the MPD version string.
	 */
	async startMonitoring(): Promise<string> {
		if (this.connection !== undefined) {
			debug("Event monitoring is already active.");
			return this.connection.getMpdVersion();
		}

		debug("Starting event monitoring...");
		try {
			this.connection = await this.connectionPool.createDedicatedConnection();
			this.setupConnectionListeners();
			this.startIdling();
			this.isMonitoring = true;

			return this.connection.getMpdVersion();
		} catch (error) {
			debug("Failed to start event monitoring:", error);
			if (this.connection !== undefined) {
				await this.connection
					.disconnect()
					.catch((e) =>
						debug("Error disconnecting after failed monitoring start:", e),
					);
				this.connection = undefined;
			}
			this.emitter.emit(
				"error",
				new Error(`Failed to start monitoring: ${error.message}`),
			);
			throw error;
		}
	}

	/**
	 * Stops monitoring MPD events by sending 'noidle' and disconnecting the dedicated connection.
	 * @returns A promise that resolves when the connection is cleanly disconnected, or rejects on error.
	 */
	async stopMonitoring(): Promise<void> {
		if (this.connection === undefined && !this.isReconnecting) {
			debug("Event monitoring is not active.");
			return;
		}

		debug("Stopping event monitoring...");
		this.isMonitoring = false;
		this.isReconnecting = false;
		this.reconnectAttempts = 0;

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}

		if (!this.connection) {
			return;
		}

		this.stopIdling();

		try {
			await this.connection.disconnect();
		} catch (error) {
			debug("Error during event connection disconnect:", error);
			// Even if disconnect fails, the connection might be unusable.
			// Ensure cleanup happens by manually clearing if necessary, though 'close' should ideally fire.
			if (this.connection !== undefined) {
				this.connection.socket?.removeAllListeners();
				this.connection = undefined;
				this.idling = false;
			}
			this.emitter.emit(
				"error",
				new Error(
					`Failed to cleanly disconnect event connection: ${error.message}`,
				),
			);
		}
	}

	/**
	 * Sends the 'idle' command to the MPD server on the dedicated event connection.
	 * Allows the server to send 'changed: subsystem' events.
	 * Only executes if monitoring is active, connected, and not already idling.
	 * @private
	 */
	private startIdling(): void {
		if (
			this.connection === undefined ||
			this.connection.isBusy() ||
			this.idling
		) {
			debug(
				"Cannot start idling: No connection, connection busy, or already idling.",
			);
			return;
		}
		if (this.connection.socket.destroyed) {
			debug("Cannot start idling: Socket is destroyed.");
			return;
		}

		debug("Starting idling...");
		this.idling = true;
		this.connection.socket.write("idle\n", "utf8", (err) => {
			if (err) {
				debug("Error writing idle command:", err);
				this.idling = false;
				this.emitter.emit(
					"error",
					new Error(`Failed to send idle command: ${err.message}`),
				);
			}
		});
	}

	/**
	 * Sends the 'noidle' command to the MPD server on the dedicated event connection.
	 * Exits the idle state, preventing further 'changed:' events until 'idle' is sent again.
	 * Only executes if currently idling and connected.
	 * @private
	 */
	private stopIdling(): void {
		if (!this.idling || this.connection === undefined) {
			debug("Cannot stop idling: Not idling or no connection.");
			return;
		}
		if (this.connection.socket.destroyed) {
			debug("Cannot stop idling: Socket is destroyed.");
			this.idling = false;
			return;
		}

		debug("Stopping idling...");
		this.connection.socket.write("noidle\n", "utf8", (err) => {
			if (err) {
				debug("Error writing noidle command:", err);
				this.emitter.emit(
					"error",
					new Error(`Failed to send noidle command: ${err.message}`),
				);
			}
			this.idling = false;
		});
		this.idling = false;
	}

	/**
	 * Handles incoming data chunks on the dedicated event connection.
	 * Parses lines, emits 'system-<subsystem>' events for 'changed:' lines,
	 * handles 'OK' to re-enter idle state, and handles 'ACK' errors.
	 * @param data - The data chunk received from the socket.
	 * @private
	 */
	private handleEventData(data: string): void {
		const lines = data.toString().split("\n");

		for (const line of lines) {
			if (line.startsWith(CHANGED_EVENT_PREFIX)) {
				const subsystem = line.substring(CHANGED_EVENT_PREFIX.length).trim();
				if (subsystem) {
					debug(`Emitting event: system-${subsystem}`);
					this.emitter.emit(`system-${subsystem}`);
					this.emitter.emit("system", subsystem);
				}
			} else if (line === OK) {
				this.idling = false;
				if (this.isMonitoring) {
					debug("Restarting idling...");
					this.startIdling();
				} else {
					debug("Monitoring is stopped, not restarting idle.");
				}
			} else if (line.startsWith(ACK_PREFIX)) {
				this.idling = false;
				debug("Received ACK during idle: %s", line);
				this.emitter.emit(
					"error",
					new MpdError(line, "Error received during idle"),
				);
				// Attempt to restart idling if monitoring is still active
				if (this.isMonitoring) {
					debug("Attempting to restart idling after ACK...");
					this.startIdling();
				}
			} else if (line) {
				debug("Received unexpected line on event connection:", line);
			}
		}
	}

	private setupConnectionListeners(): void {
		if (!this.connection) {
			return;
		}

		this.connection.socket.on("data", (data: Buffer) => {
			this.handleEventData(data.toString("utf8"));
		});

		this.connection.socket.on("close", (hadError: boolean) => {
			debug(`Event connection closed${hadError ? " with error" : ""}.`);
			this.connection?.socket?.removeAllListeners();
			this.connection = undefined;
			this.idling = false;

			if (this.isMonitoring && !this.isReconnecting) {
				this.attemptReconnect();
			} else if (!this.isMonitoring) {
				this.emitter.emit(
					"close",
					hadError
						? new Error("Event connection closed due to error")
						: undefined,
				);
			}
		});

		this.connection.socket.on("error", (err: Error) => {
			debug("Event connection error:", err);
			this.emitter.emit("error", err);
		});
	}

	private attemptReconnect(): void {
		if (this.isReconnecting || !this.isMonitoring) {
			return;
		}

		if (this.reconnectAttempts >= (this.config.maxRetries ?? 3)) {
			debug("Max reconnection attempts reached.");
			this.isMonitoring = false;
			this.reconnectAttempts = 0;
			this.emitter.emit(
				"close",
				new Error("Event connection closed after max reconnection attempts"),
			);
			return;
		}

		this.isReconnecting = true;
		this.reconnectAttempts++;

		const delay = this.config.reconnectDelay ?? 5000;
		debug(
			`Attempting reconnection ${this.reconnectAttempts}/${this.config.maxRetries ?? 3} in ${delay}ms...`,
		);

		this.reconnectTimer = setTimeout(async () => {
			try {
				this.connection = await this.connectionPool.createDedicatedConnection();
				this.setupConnectionListeners();
				this.startIdling();
				this.reconnectAttempts = 0;
				this.isReconnecting = false;
				debug("Successfully reconnected event connection.");
			} catch (error) {
				debug(`Reconnection attempt ${this.reconnectAttempts} failed:`, error);
				this.isReconnecting = false;
				this.attemptReconnect();
			}
		}, delay);
	}
}
