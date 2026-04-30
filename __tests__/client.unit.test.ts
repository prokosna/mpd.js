import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Config } from "../lib/client";

const startMonitoring = vi.fn().mockResolvedValue("0.23.5");
const stopMonitoring = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/connection", () => {
	return {
		ConnectionPool: vi.fn().mockImplementation(() => ({})),
		Connection: vi.fn(),
	};
});

vi.mock("../lib/event", () => {
	return {
		EventManager: vi.fn().mockImplementation(() => ({
			startMonitoring,
			stopMonitoring,
		})),
	};
});

vi.mock("../lib/executor", () => {
	return {
		CommandExecutor: vi.fn().mockImplementation(() => ({})),
	};
});

import { Client } from "../lib/client";

const ClientCtor = Client as unknown as new (config: Config) => Client;

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("Client system-event listener handling", () => {
	beforeEach(() => {
		startMonitoring.mockClear();
		stopMonitoring.mockClear();
	});

	it("starts monitoring when a 'system' listener is added", async () => {
		const client = new ClientCtor({ host: "localhost", port: 6600 });

		client.on("system", () => {});
		await flush();

		expect(startMonitoring).toHaveBeenCalled();
	});

	it("starts monitoring when a 'system-<subsystem>' listener is added", async () => {
		const client = new ClientCtor({ host: "localhost", port: 6600 });

		client.on("system-player", () => {});
		await flush();

		expect(startMonitoring).toHaveBeenCalled();
	});

	it("ignores listeners whose name merely contains 'system'", async () => {
		const client = new ClientCtor({ host: "localhost", port: 6600 });

		client.on("mySystemEvent", () => {});
		client.on("subsystem", () => {});
		client.on("ecosystem-player", () => {});
		client.on("systemic", () => {});
		await flush();

		expect(startMonitoring).not.toHaveBeenCalled();
	});

	it("does not stop monitoring when a system listener is removed", async () => {
		const client = new ClientCtor({ host: "localhost", port: 6600 });

		const handler = () => {};
		client.on("system", handler);
		await flush();

		client.off("system", handler);
		await flush();

		expect(stopMonitoring).not.toHaveBeenCalled();
	});

	it("does not stop monitoring when all system listeners are removed", async () => {
		const client = new ClientCtor({ host: "localhost", port: 6600 });

		const handlerA = () => {};
		const handlerB = () => {};
		client.on("system", handlerA);
		client.on("system-player", handlerB);
		await flush();

		client.off("system", handlerA);
		client.off("system-player", handlerB);
		await flush();

		expect(stopMonitoring).not.toHaveBeenCalled();
	});

	it("invokes startMonitoring once per matching newListener (deduplication is EventManager's responsibility, see Task 6)", async () => {
		const client = new ClientCtor({ host: "localhost", port: 6600 });

		client.on("system", () => {});
		client.on("system-player", () => {});
		client.on("system-mixer", () => {});
		await flush();

		expect(startMonitoring).toHaveBeenCalledTimes(3);
	});

	it("does not surface startMonitoring rejections as unhandled", async () => {
		startMonitoring.mockRejectedValueOnce(new Error("boom"));

		const client = new ClientCtor({ host: "localhost", port: 6600 });

		const unhandledRejections: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandledRejections.push(reason);
		process.on("unhandledRejection", onUnhandled);

		client.on("system", () => {});
		await flush();
		await flush();

		process.off("unhandledRejection", onUnhandled);
		expect(unhandledRejections).toHaveLength(0);
	});
});
