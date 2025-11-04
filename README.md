# MPD Client for Node.js

[![Build Status](https://github.com/prokosna/mpd.js/actions/workflows/test.yml/badge.svg)](https://github.com/prokosna/mpd.js/actions/workflows/test.yml)

Connect to a [Music Player Daemon](https://musicpd.org) (MPD) server, send commands, and receive events.

This library is a re-write version of the original [mpd.js (mpd2)](https://github.com/cotko/mpd.js) library, fully implemented in TypeScript and leveraging the **Web Streams API**. This design allows for efficient, non-blocking handling of MPD responses with multiple connections, even for large music libraries or playlists.

## Installation

```bash
npm i prokosna/mpd.js
```

## Basic Usage

```typescript
import { Client, Parsers } from "mpd3";

async function main() {
  // Connect to MPD server (defaults to localhost:6600)
  const client = await Client.connect({
    host: "localhost",
    port: 6600,
  });

  try {
    console.log("Connected to MPD!");
    console.log();

    // Get current status - using sendCommand
    const status = await client.sendCommand("status");
    console.log("Status:", status);
    console.log();

    // Get current playlist info as a stream - using streamCommands
    // This is a raw stream of lines fetched from MPD.
    // OK and ACK are handled by stream's end and error events.
    const playlistInfoStream = await client.streamCommands(["playlistinfo"]);
    // Transform the stream into a list of objects
    const playlistInfoListStream = playlistInfoStream.pipeThrough(
      Parsers.transformToList({ delimiterKeys: "file" })
    );
    // Transform the list of objects into a typed list
    const playlistInfoTypedListStream = playlistInfoListStream.pipeThrough(
      Parsers.transformToTyped()
    );
    // Aggregate the list into an array
    const playlistInfo = await Parsers.aggregateToList(
      playlistInfoTypedListStream
    );
    console.log("Playlist Info (Count):", playlistInfo.length); // Result is an array of track objects
    console.log();

    // Other transforms are available in Parsers
    const listAllInfo = await client
      .streamCommand("listallinfo")
      .then((stream) =>
        stream
          .pipeThrough(
            Parsers.transformToListAndAccumulate({
              delimiterKeys: ["directory", "file"],
            })
          )
          .pipeThrough(Parsers.transformToTyped())
      )
      .then(Parsers.aggregateToList);
    console.log("List All Info (Count):", listAllInfo.length); // Result is an array of track objects
    console.log();

    // Get object from stream
    const stats = await client
      .streamCommand("stats")
      .then((stream) => stream.pipeThrough(Parsers.transformToObject()))
      .then(Parsers.takeFirstObject);
    console.log("Stats:", stats);
    console.log();

    // Listen for events
    client.on("system", (subsystem) => {
      console.log(`MPD subsystem changed: ${subsystem}`);
    });

    // Stop track if playlist is not empty
    if (playlistInfo.length > 0) {
      await client.sendCommand("play 0");
      console.log("Playback started.");
    } else {
      console.log("Playlist is empty, cannot start playback.");
    }
    console.log();

    // Keep the script running to listen for events
    console.log("Listening for MPD events... (Press Ctrl+C to exit)");
  } catch (error) {
    console.error("MPD Error:", error);
  } finally {
    process.on("SIGINT", async () => {
      console.log("\nDisconnecting...");
      await client.disconnect();
      console.log("Disconnected from MPD.");
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error("Unhandled error in main:", err);
  process.exit(1);
});
```

## API

### `Client.connect(config?: Config): Promise<Client>`

_Static Method_

Establishes connection(s) to the MPD server and returns a connected `Client` instance. This is the primary way to create a client.

**Options (`Config` type, extends `net.NetConnectOpts`):**

- `host` (string): MPD server hostname (default: `localhost`).
- `port` (number): MPD server port (default: `6600`).
- `password` (string): Optional MPD password.
- `timeout` (number): Connection timeout in milliseconds (default: `5000`).
- `poolSize` (number): Maximum number of connections in the pool (default: `3`).
- `reconnectDelay` (number): Delay in milliseconds between reconnection attempts (default: `5000`).
- `maxRetries` (number): Maximum number of reconnection attempts. Used for both initial connection and event monitoring reconnection (default: `3`).

**Reconnection Behavior:**

The client implements automatic reconnection in two scenarios:

1. **Initial Connection**: If `Client.connect()` fails, it will retry up to `maxRetries` times with `reconnectDelay` between each attempt.
2. **Event Monitoring**: If the event monitoring connection drops (used for system events), the client automatically attempts to reconnect up to `maxRetries` times. System events will continue to be emitted after successful reconnection. A `close` event is only emitted after all reconnection attempts have been exhausted.

### `client.sendCommand(command: string | Command): Promise<string>`

Sends a command to the MPD server.

- **`command`**: The command string (e.g., `'status'`) or a `Command` object.

**Returns:** A `Promise` resolving to the **full response string** aggregated from the server, including the final `OK` line.

### `client.sendCommands(commandList: (string | Command)[]): Promise<string>`

Sends multiple commands as a single [command list](https://mpd.readthedocs.io/en/latest/protocol.html#command-lists) to the MPD server.

- **`commandList`**: An array of command strings or `Command` objects.

**Returns:** A `Promise` resolving to the **full response string** aggregated from the server for the entire command list.

### `client.streamCommand(command: string | Command): Promise<ReadableStream<ResponseLine>>`

Sends a single command and returns the response as a `ReadableStream`.

- **`command`**: The command string or `Command` object.

**Returns:** A `Promise` resolving to a `ReadableStream` where each chunk is a `ResponseLine` object (`{ raw: string }` containing one line of the MPD response, excluding the final `OK`). Useful for processing large responses line by line.

### `client.streamCommands(commandList: (string | Command)[]): Promise<ReadableStream<ResponseLine>>`

Sends multiple commands as a command list and returns the response as a `ReadableStream`.

- **`commandList`**: An array of command strings or `Command` objects.

**Returns:** A `Promise` resolving to a `ReadableStream` of `ResponseLine` objects for the entire command list response.

### `client.disconnect(): Promise<void>`

Closes all connections to the MPD server, stops event monitoring, and cleans up resources.

### `client.PROTOCOL_VERSION: string` (Getter)

Returns the MPD protocol version reported by the server during the initial connection.

### `Parsers`

There are several parsers available in the `Parsers` namespace:

- `transformToList`
- `transformToListAndAccumulate`
- `transformToObject`
- `transformToTyped`
- `aggregateToList`
- `aggregateToObject`
- `takeFirstLineValue`
- `takeFirstObject`
- `takeFirstBinary`

These utility functions are used by `pipeThrough()` or `then()` of Promise<ReadableStream>.

## Events

The `Client` instance extends `EventEmitter`.

- **`system`** (subsystem: string): Emitted when MPD reports a change in one of its subsystems (e.g., `player`, `mixer`, `options`, `playlist`). This event continues to be emitted after automatic reconnection.
- **`error`** (error: Error): Emitted when a connection or protocol error occurs within the connection pool or event monitoring.
- **`close`** (error?: Error): Emitted when the `disconnect()` method is called, or when the event monitoring connection fails after exhausting all reconnection attempts. If an error is provided, the connection was closed due to that error.
