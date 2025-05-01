import { escapeArg } from "./parserUtils";

/**
 * Represents an MPD command with a name and arguments.
 * Provides a helper method to create instances and a method to serialize the command to a string.
 */
export class Command {
	readonly name: string;
	readonly args: (string | number)[];

	/**
	 * Creates an instance of Command.
	 * Allows arguments to be passed either as individual arguments or as a single array.
	 * @param name - The name of the MPD command (e.g., 'status', 'playid').
	 * @param args - The arguments for the command. Can be passed as rest parameters (`...args`) or as a single array (`[arg1, arg2]`).
	 */
	constructor(
		name: string,
		...inputArgs: (string | number)[] | [(string | number)[]]
	) {
		if (inputArgs.length === 1 && Array.isArray(inputArgs[0])) {
			this.args = inputArgs[0];
		} else {
			this.args = inputArgs as (string | number)[];
		}
		this.name = name;
	}

	/**
	 * Static factory method to create Command instances using a single array for arguments.
	 * @param name - The name of the MPD command.
	 * @param args - An array containing the arguments for the command.
	 * @returns A new Command instance.
	 */
	static cmd(name: string, args: (string | number)[]): Command;
	/**
	 * Static factory method to create Command instances using rest parameters for arguments.
	 * @param name - The name of the MPD command.
	 * @param args - The arguments for the command passed as individual parameters.
	 * @returns A new Command instance.
	 */
	static cmd(name: string, ...args: (string | number)[]): Command;
	/**
	 * @internal Implementation signature for the overloaded static cmd method.
	 * Use the specific overload signatures for external calls.
	 */
	// Implementation signature using a specific union type to avoid 'any'
	static cmd(
		name: string,
		...argsOrArray: [(string | number)[]] | (string | number)[]
	): Command {
		return new Command(name, ...argsOrArray);
	}

	/**
	 * Serializes the command into the string format expected by the MPD protocol.
	 * Arguments are properly escaped.
	 * @returns The command string (e.g., 'playid "123"').
	 */
	toString(): string {
		const escaped = this.args.map(escapeArg).join(" ");
		return `${this.name} ${escaped}`;
	}
}
