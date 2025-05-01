import { MpdError, isError } from "../lib/error";

describe("MPDError", () => {
	test("should create error with code and message", () => {
		const error = new MpdError("ACK [5@1] {test} test error");
		expect(error.code).toBe("UNKNOWN");
		expect(error.errno).toBe(5);
		expect(error.cmd_list_num).toBe(1);
		expect(error.current_command).toBe("test");
		expect(error.message).toBe("test error");
	});

	test("should handle error with different code", () => {
		const error = new MpdError("ACK [2@0] {play} invalid argument");
		expect(error.code).toBe("ARG");
		expect(error.errno).toBe(2);
		expect(error.cmd_list_num).toBe(0);
		expect(error.current_command).toBe("play");
		expect(error.message).toBe("invalid argument");
	});

	test("should handle malformed error response", () => {
		const error = new MpdError("invalid error");
		expect(error.code).toBe("invalid error");
		expect(error.message).toBe("invalid error");
		expect(error.errno).toBeUndefined();
		expect(error.cmd_list_num).toBeUndefined();
		expect(error.current_command).toBeUndefined();
	});
});

describe("isError", () => {
	test("should identify MPD error responses", () => {
		const result1 = isError("ACK [5@1] {test} error");
		expect(result1).toBeInstanceOf(MpdError);
		expect(result1?.code).toBe("UNKNOWN");
		expect(result1?.errno).toBe(5);
		expect(result1?.cmd_list_num).toBe(1);
		expect(result1?.current_command).toBe("test");
		expect(result1?.message).toBe("error");

		const result2 = isError("OK");
		expect(result2).toBeNull();

		const result3 = isError("some other response");
		expect(result3).toBeNull();
	});
});
