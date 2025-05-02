import type { ReadableStream } from "node:stream/web";
import type { Command } from "./command.js";
import type { ConnectionPool, Connection } from "./connection.js";
import { PACKAGE_NAME, EVENT_CONNECTION_AVAILABLE } from "./const.js";
import debugCreator from "debug";
import type { ResponseLine } from "./types.js";

const debug = debugCreator(`${PACKAGE_NAME}:queue`);

/**
 * Represents an item waiting in the command queue.
 */
export interface QueueItem {
	/** The MPD command(s) to be executed. Can be a single command string,
	 * a Command object, or an array of either for command lists. */
	commands: string | Command | (string | Command)[];
	/** The priority of the command(s). Higher numbers are processed first. */
	priority: number;
	/** The resolve function of the Promise associated with this queue item.
	 * Called with the response stream upon successful execution. */
	resolve: (data: ReadableStream<ResponseLine>) => void;
	/** The reject function of the Promise associated with this queue item.
	 * Called with an error if execution fails. */
	// biome-ignore lint/suspicious/noExplicitAny: built-in Promise reject
	reject: (reason?: any) => void;
}

/**
 * Manages a priority queue for sending commands to the MPD server.
 * Ensures that commands are sent sequentially using available connections
 * from a provided ConnectionPool, respecting command priority.
 */
export class CommandQueue {
	private queue: QueueItem[] = [];
	private connectionPool: ConnectionPool;

	/**
	 * Creates a new CommandQueue instance.
	 * @param connectionPool The connection pool used to acquire connections for sending commands.
	 */
	constructor(connectionPool: ConnectionPool) {
		this.connectionPool = connectionPool;
	}

	/**
	 * Adds a command or a list of commands to the queue.
	 *
	 * @param commands The command string(s) or Command object(s) to enqueue.
	 *                 Use an array for MPD command lists.
	 * @param priority The priority of this command (higher value means higher priority). Defaults to 0.
	 * @returns A Promise that resolves with a ReadableStream of ResponseLine objects
	 *          representing the MPD server's response, or rejects if an error occurs
	 *          during queuing or execution.
	 */
	enqueue(
		commands: string | Command | (string | Command)[],
		priority = 0,
	): Promise<ReadableStream<ResponseLine>> {
		return new Promise((resolve, reject) => {
			const item: QueueItem = {
				commands,
				priority,
				resolve,
				reject,
			};

			this.pushAndSortItem(item);

			queueMicrotask(() => this.processQueue());
		});
	}

	/**
	 * Internal helper to add an item to the queue and maintain priority order.
	 * The queue is sorted descending by priority (highest first).
	 * @param item The QueueItem to add.
	 */
	private pushAndSortItem(item: QueueItem): void {
		this.queue.push(item);
		this.queue.sort((a, b) => b.priority - a.priority);
	}

	/**
	 * Processes the command queue.
	 * Attempts to dequeue the highest priority item and execute it using an
	 * available connection from the pool. This method is triggered automatically
	 * when commands are enqueued.
	 */
	private async processQueue(): Promise<void> {
		if (this.queue.length === 0) {
			debug("Queue is empty, skipping processing.");
			return;
		}

		let item: QueueItem | undefined = undefined;
		let connection: Connection | undefined = undefined;
		try {
			item = this.queue.shift();
			if (item === undefined) {
				console.warn("Queue became empty unexpectedly before processing.");
				return;
			}

			connection = await this.connectionPool.getConnection();

			if (Array.isArray(item.commands)) {
				const result = connection.executeCommands(item.commands);
				item.resolve(result);
			} else {
				const result = connection.executeCommand(item.commands);
				item.resolve(result);
			}
		} catch (error) {
			// Error acquiring connection OR processing command.
			debug(`Error processing queue: ${error.message}`);
			if (item !== undefined) {
				item.reject(error);
			} else {
				console.error(
					"Error processing queue, but item was unexpectedly undefined. This indicates a logic error.",
					error,
				);
			}
		} finally {
			if (connection) {
				this.connectionPool.releaseConnection(connection);
			}
			debug("Finished queue processing cycle.");
		}
	}
}
