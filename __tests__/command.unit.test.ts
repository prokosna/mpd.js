import { describe, expect, test } from "vitest";
import { Command } from "../lib";

describe("Command", () => {
	test("should create simple command", () => {
		const cmd = new Command("status");
		expect(cmd.toString()).toBe("status ");
	});

	test("should create command with arguments", () => {
		const cmd = new Command("play", 1);
		expect(cmd.toString()).toBe('play "1"');
	});

	test("should handle multiple arguments", () => {
		const cmd = new Command("add", "file.mp3", "playlist");
		expect(cmd.toString()).toBe('add "file.mp3" "playlist"');
	});

	test("should escape special characters in arguments", () => {
		const cmd = new Command("add", "file with spaces.mp3", 'playlist "quoted"');
		expect(cmd.toString()).toBe(
			'add "file with spaces.mp3" "playlist \\"quoted\\""',
		);
	});

	test("should create command list", () => {
		const cmd = new Command("command_list_begin");
		expect(cmd.toString()).toBe("command_list_begin ");
	});

	test("should create command list end", () => {
		const cmd = new Command("command_list_end");
		expect(cmd.toString()).toBe("command_list_end ");
	});

	test("should accept any non-empty string as command name", () => {
		const cmd = new Command("anycommand");
		expect(cmd.toString()).toBe("anycommand ");
	});
});
