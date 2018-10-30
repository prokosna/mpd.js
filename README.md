# node mpd client

Connect to a [music player daemon](http://musicpd.org) server, send commands,
emit events.

You might also be interested in checking out
[node-groove](https://github.com/andrewrk/node-groove),
a generic music player backend as a node module.

Or maybe [Groove Basin](https://github.com/andrewrk/groovebasin),
a music player server which supports the MPD protocol and has many
[features and improvements](http://andrewkelley.me/post/quest-build-ultimate-music-player.html)
over MPD.

## Usage

```js
var mpd = require('mpd'),
    cmd = mpd.cmd
var client = mpd.connect({
  port: 6600,
  host: 'localhost',
});
client.on('ready', function() {
  console.log("ready");
});
client.on('system', function(name) {
  console.log("update", name);
});
client.on('system-player', function() {
  client.sendCommand(cmd("status", []), function(err, msg) {
    if (err) throw err;
    console.log(msg);
  });
});
```

## Documentation

See also the [MPD Protocol Documentation](http://www.musicpd.org/doc/protocol/).

### Functions

#### mpd.cmd(name, args)

Convert name/args pair into a Command.

#### mpd.connect(options)

Connects and returns a client.

#### mpd.parseKeyValueMessage(msg)

`msg`: a string which contains an MPD response.
Returns an object.

#### mpd.parseArrayMessage(msg)

`msg`: a string which contains an MPD response.
Returns an array.

#### mpd.parseSongArrayMessage(msg)

`msg`: a string which contains an MPD response.
Returns an array. This should be used for parsing
song list messages instead of `parseArrayMessage()` method.

#### client.sendCommand(command, callback)

`command` can be a `MpdClient.Command` or a string.

#### client.sendCommands(commandList, callback)

### Events

#### error(err)

#### end

The connection is closed.

#### connect

A socket connection has been made.

#### ready

The mpd server is ready to accept commands.

#### system(systemName)

A system has updated. `systemName` is one of:

  * `database` - the song database has been modified after update.
  * `update` - a database update has started or finished. If the database was
    modified during the update, the database event is also emitted.
  * `stored_playlist` - a stored playlist has been modified, renamed, created
    or deleted
  * `playlist` - the current playlist has been modified
  * `player` - the player has been started, stopped or seeked
  * `mixer` - the volume has been changed
  * `output` - an audio output has been enabled or disabled
  * `options` - options like repeat, random, crossfade, replay gain
  * `sticker` - the sticker database has been modified.
  * `subscription` - a client has subscribed or unsubscribed to a channel
  * `message` - a message was received on a channel this client is subscribed
    to; this event is only emitted when the queue is empty

#### system-*

See above event. Each system name has its own event as well.

### Properties

#### mpd.PROTOCOL_VERSION

Protocol version returned by the MPD server after connection is established

#### mpd.ACK_ERROR_CODES

ACK codes map, as seen here [Ack.hxx](https://github.com/MusicPlayerDaemon/MPD/blob/master/src/protocol/Ack.hxx)

```js
ACK_ERROR_CODES = {
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
  EXIST: 56
}
```

### Error handling

MPD errors are reported as

```
ACK [error@command_listNum] {current_command} message_text
```

When such error is received, it is thrown as a MPDError:

```js
MPDError {
  err: "MPDError: <message_text>",
  name: "MPDError",
  ack_code: "<ACK_ERROR_CODE>", // ex: ARG
  ack_code_num: <ACK_CODE_NUMBER>, // ex: 2 for ARG
  message: "<message_text>",
  cmd_list_num: <command_listNum>,
  current_command: "<current_command>"
}
```
