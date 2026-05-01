import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Config } from "../lib/client";

const startMonitoring = vi.fn().mockResolvedValue("0.23.5");
const stopMonitoring = vi.fn().mockResolvedValue(undefined);
const createDedicatedConnection = vi.fn();

vi.mock("../lib/connection", () => {
	return {
		ConnectionPool: vi.fn().mockImplementation(function () {
			return {
				createDedicatedConnection,
			};
		}),
		Connection: vi.fn(),
	};
});

vi.mock("../lib/event", () => {
	return {
		EventManager: vi.fn().mockImplementation(function () {
			return {
				startMonitoring,
				stopMonitoring,
			};
		}),
	};
});

vi.mock("../lib/executor", () => {
	return {
		CommandExecutor: vi.fn().mockImplementation(function () {
			return {};
		}),
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

	it("invokes startMonitoring on every matching newListener; EventManager deduplicates the actual connection attempt", async () => {
		const client = new ClientCtor({ host: "localhost", port: 6600 });

		client.on("system", () => {});
		client.on("system-player", () => {});
		client.on("system-mixer", () => {});
		await flush();

		expect(startMonitoring).toHaveBeenCalledTimes(3);
	});
});

describe("Client.connect config handling", () => {
	beforeEach(() => {
		createDedicatedConnection.mockReset();
	});

	it("does not mutate the caller's config object", async () => {
		createDedicatedConnection.mockRejectedValue(new Error("nope"));

		const config: Config = {
			host: "localhost",
			port: 6600,
			maxRetries: 0,
			reconnectDelay: 0,
		};
		const snapshot = JSON.parse(JSON.stringify(config));

		await expect(Client.connect(config)).rejects.toThrow();

		expect(config).toEqual(snapshot);
	});
});
