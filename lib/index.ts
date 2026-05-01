import { Client } from "./client.js";
import { Command } from "./command.js";
import { MpdError } from "./error.js";
import type {
	MpdTypedObject,
	ParsedAudio,
	ParsedRange,
	ParsedTime,
	ResponseLine,
} from "./types.js";

export default Client;
export type { ListParserOptions, ObjectParsingOptions } from "./parsers.js";
export {
	aggregateToList,
	aggregateToString,
	Parsers,
	takeFirstBinary,
	takeFirstLineValue,
	takeFirstObject,
	transformToList,
	transformToListAndAccumulate,
	transformToObject,
	transformToTyped,
} from "./parsers.js";
export type {
	MpdTypedObject,
	ParsedAudio,
	ParsedRange,
	ParsedTime,
	ResponseLine,
};
export { Client, Command, MpdError };
