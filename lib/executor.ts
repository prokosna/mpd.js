import type { ReadableStream } from "node:stream/web";
import type { Command } from "./command.js";
import type { ConnectionPool, Connection } from "./connection.js";
import { PACKAGE_NAME } from "./const.js";
import debugCreator from "debug";
import type { ResponseLine } from "./types.js";

const debug = debugCreator(`${PACKAGE_NAME}:executor`);

/**
 * Represents a command item waiting to be executed.
 */
export interface CommandItem {
	/** The MPD command(s) to be executed. Can be a single command string,
	 * a Command object, or an array of either for command lists. */
	commands: string | Command | (string | Command)[];
	/** The resolve function of the Promise associated with this command item.
	 * Called with the response stream upon successful execution. */
	resolve: (data: ReadableStream<ResponseLine>) => void;
	/** The reject function of the Promise associated with this command item.
	 * Called with an error if execution fails. */
	// biome-ignore lint/suspicious/noExplicitAny: built-in Promise reject
	reject: (reason?: any) => void;
}

/**
 * Manages the execution of commands using available connections from a ConnectionPool.
 */
export class CommandExecutor {
	private connectionPool: ConnectionPool;

	/**
	 * Creates a new CommandExecutor instance.
	 * @param connectionPool The connection pool used to acquire connections for sending commands.
	 */
	constructor(connectionPool: ConnectionPool) {
		this.connectionPool = connectionPool;
	}

	/**
	 * Executes a command or a list of commands.
	 *
	 * @param commands The command string(s) or Command object(s) to execute.
	 *                 Use an array for MPD command lists.
	 * @returns A Promise that resolves with a ReadableStream of ResponseLine objects
	 *          representing the MPD server's response, or rejects if an error occurs
	 *          during execution.
	 */
	execute(
		commands: string | Command | (string | Command)[],
	): Promise<ReadableStream<ResponseLine>> {
		return new Promise((resolve, reject) => {
			const item: CommandItem = {
				commands,
				resolve,
				reject,
			};

			queueMicrotask(() => this.processItem(item));
		});
	}

	/**
	 * Processes a single item.
	 */
	private async processItem(item: CommandItem): Promise<void> {
		let connection: Connection | undefined = undefined;
		try {
			connection = await this.connectionPool.getConnection();

			if (Array.isArray(item.commands)) {
				const result = connection.executeCommands(item.commands);
				item.resolve(result);
			} else {
				const result = connection.executeCommand(item.commands);
				item.resolve(result);
			}
		} catch (error) {
			debug(`Error processing command: ${error.message}`);
			item.reject(error);
		} finally {
			if (connection) {
				this.connectionPool.releaseConnection(connection);
			}
			debug("Finished command processing.");
		}
	}
}
