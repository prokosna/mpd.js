import { Client } from "./client.js";
import { Command } from "./command.js";
import { MpdError } from "./error.js";
import { Parsers } from "./parsers.js";
import type {
	MpdTypedObject,
	ParsedAudio,
	ParsedRange,
	ParsedTime,
	ResponseLine,
} from "./types.js";

export default Client;
export type {
	MpdTypedObject,
	ParsedAudio,
	ParsedRange,
	ParsedTime,
	ResponseLine,
};
export { Client, Command, MpdError, Parsers };
