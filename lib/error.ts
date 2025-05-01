const CODES: Record<string, number> = {
	NOT_LIST: 1,
	ARG: 2,
	PASSWORD: 3,
	PERMISSION: 4,
	UNKNOWN: 5,
	NO_EXIST: 50,
	PLAYLIST_MAX: 51,
	SYSTEM: 52,
	PLAYLIST_LOAD: 53,
	UPDATE_ALREADY: 54,
	PLAYER_SYNC: 55,
	EXIST: 56,
};

const CODES_REVERSED: Record<number, string> = Object.keys(CODES).reduce(
	(memo, key) => {
		memo[CODES[key]] = key;
		return memo;
	},
	{} as Record<number, string>,
);

/**
 * Represents an error reported by the MPD server (ACK response).
 * Parses the error message to extract details like error code,
 * command index (for command lists), current command, and the message text.
 */
export class MpdError extends Error {
	/** The symbolic error code string (e.g., 'ARG', 'PASSWORD') or the raw numeric code if unknown. */
	code: string | number;
	/** The numeric MPD error code. */
	errno?: number;
	/** The index of the command within a command list that caused the error. */
	cmd_list_num?: number;
	/** The command that caused the error. */
	current_command?: string;
	/** Additional information associated with the error. */
	info?: unknown;

	/**
	 * Creates an instance of MpdError.
	 * @param str - The raw ACK error string from the MPD server.
	 * @param code - An optional fallback code if parsing fails.
	 * @param info - Optional additional info to attach to the error.
	 */
	constructor(str: string, code?: string | number, info?: unknown) {
		super();

		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}

		// error response:
		// ACK [error@command_listNum] {current_command} message_text

		// parse error and command_listNum
		const errCode = str.match(/\[(.*?)\]/);
		this.name = "MPDError";

		if (!errCode || !errCode.length) {
			this.message = str;
			this.code = code || str;
		} else {
			const [error, cmdListNum] = errCode[1].split("@");
			const currentCommand = str.match(/{(.*?)}/);
			const msg = str.split("}")[1].trim();

			this.code = CODES_REVERSED[error] || "??";
			this.errno = Number(error) | 0;
			this.message = msg;
			this.cmd_list_num = Number(cmdListNum) | 0;
			this.current_command = currentCommand[1];
		}

		if (info) {
			this.info = info;
		}
	}

	/** MPD error codes mapped to their numeric values. */
	static CODES = CODES;
	/** MPD numeric error codes mapped to their symbolic names. */
	static CODES_REVERSED = CODES_REVERSED;
}

/**
 * Checks if a response line string represents an MPD error (starts with "ACK").
 * If it is an error, creates and returns an MpdError instance.
 * @param responseLine - The response line string to check.
 * @returns An MpdError instance if the line is an error, otherwise null.
 */
export const isError = (responseLine: unknown): MpdError | null => {
	return String(responseLine).startsWith("ACK")
		? new MpdError(String(responseLine))
		: null;
};
