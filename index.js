var EventEmitter = require('events').EventEmitter
  , util = require('util')
  , assert = require('assert')
  , net = require('net')
  , MPD_SENTINEL = /^(OK|ACK|list_OK)(.*)$/m
  , OK_MPD = /^OK MPD /

module.exports = MpdClient;
MpdClient.Command = Command
/**
 * Convenience method to construct a new [Command]{@link MPDClient.Command}
 * @memberof MPDClient
 * @name cmd
 * @function
 * @param {String} name command name
 * @param {Array<String>} args extra arguments
 * @returns {Command} new Command(name, args);
 */
MpdClient.cmd = cmd;

/**
 * Parse MPD response containing a key value pairs
 *
 * @memberof MPDClient
 * @name parseKeyValueMessage
 * @function
 * @param {String} msg MPD command result
 * @returns {Object} with parsed key-value pairs
 */
MpdClient.parseKeyValueMessage = parseKeyValueMessage;

/**
 * Parse MPD list response
 *
 * @memberof MPDClient
 * @name parseArrayMessage
 * @function
 * @param {String} msg MPD command result
 * @returns {Array<Object>}
 */
MpdClient.parseArrayMessage = parseArrayMessage;

/**
 * Same as parseArrayMessage but ment for songs
 *
 * @name parseSongArrayMessage
 * @memberof MPDClient
 * @function
 * @param {String} msg MPD command result
 * @returns {Array<Object>}
 */
MpdClient.parseSongArrayMessage = parseSongArrayMessage;

/**
 * @enum {Number}
 * @memberof MPDClient
 *
 */
let ACK_ERROR_CODES = {
  /** 1 */
  NOT_LIST: 1,
  /** 2 */
  ARG: 2,
  /** 3 */
  PASSWORD: 3,
  /** 4 */
  PERMISSION: 4,
  /** 5 */
  UNKNOWN: 5,

  /** 50 */
  NO_EXIST: 50,
  /** 51 */
  PLAYLIST_MAX: 51,
  /** 52 */
  SYSTEM: 52,
  /** 53 */
  PLAYLIST_LOAD: 53,
  /** 54 */
  UPDATE_ALREADY: 54,
  /** 55 */
  PLAYER_SYNC: 55,
  /** 56 */
  EXIST: 56
};

MpdClient.ACK_ERROR_CODES = ACK_ERROR_CODES

/**
 * @memberof MPDClient
 * @member {Object}
 * @name ACK_ERROR_CODES_REVERSED
 */
MpdClient.ACK_ERROR_CODES_REVERSED = Object
  .keys(MpdClient.ACK_ERROR_CODES)
  .reduce((memo, reason) => {
    memo[MpdClient.ACK_ERROR_CODES[reason]] = reason
    return memo
  }, {})


class MPDError extends Error {

  constructor(str, extra) {
    super()
    Error.captureStackTrace(this, this.constructor)

    // error response:
    // ACK [error@command_listNum] {current_command} message_text

    // parse error and command_listNum
    var err_code = str.match(/\[(.*?)\]/)
    this.name = 'MPDError'

    // safety fallback just in case
    if (!err_code || !err_code.length) {
      this.message = str

    } else {
      var [error, cmd_list_num] = err_code[1].split('@')
      var current_command = str.match(/{(.*?)}/)
      var msg = str.split('}')[1].trim()

      this.ack_code = MpdClient.ACK_ERROR_CODES_REVERSED[error] || '??'
      this.ack_code_num = error|0
      this.message = msg
      this.cmd_list_num = cmd_list_num|0
      this.current_command = current_command[1]
    }
  }

  toJSON() {
    let obj = {}
    for (let key of Object.keys(this)) {
      obj[key] = this[key]
    }
    return {
      err: this.toString(),
      ...obj
    }
  }

}

/**
 * @classdesc A MPD client class
 *
 *  MPD protocol reports errors as:
 *  ```
 *  ACK [error@command_listNum] {current_command} message_text
 *  ```
 * When such error is received, it is thrown as a MPDError:
 *
 * ```js
 * MPDError {
 *   err: "MPDError: <message_text>",
 *   name: "MPDError",
 *   ack_code: "<ACK_ERROR_CODE>", // ex: ARG
 *   ack_code_num: <ACK_CODE_NUMBER>, // ex: 2 for ARG
 *   message: "<message_text>",
 *   cmd_list_num: <command_listNum>,
 *   current_command: "<current_command>"
 * }
 * ```
 *
 * Fires these events:
 * ```js
 * 'error'
 * 'end' // the connection is closed
 * 'connect' // a socket connection has been made
 * 'ready' // the mpd server is ready to accept commands
 *
 * 'system(systemName)' // A system has updated. systemName is one of:
 *
 *    // database         the song database has been modified after update
 *    // update           a database update has started or finished.
 *                        If the database was modified during the update,
 *                        the database event is also emitted
 *    // stored_playlist  a stored playlist has been modified, renamed,
 *                        created or deleted
 *    // playlist         the current playlist has been modified
 *    // player           the player has been started, stopped or seeked
 *    // mixer            the volume has been changed
 *    // output           an audio output has been enabled or disabled
 *    // options          options like repeat, random, crossfade, replay gain
 *    // sticker          the sticker database has been modified
 *    // subscription     a client has subscribed or unsubscribed to a channel
 *    // message          a message was received on a channel this client is 
 *                        subscribed to; this event is only emitted when the queue is empty
 *
 *  'system-*' // See above event. Each system name has its own event as well.
 * ```
 *
 * @class
 * @name MPDClient
 * @extends {events.EventEmitter}
 * @constructor
 * @property {String} PROTOCOL_VERSION version of protocol used
 * @property {Socket} socket
 *  {@link https://nodejs.org/api/net.html#net_class_net_socket a nodejs socket}
 *
 */
function MpdClient() {
  EventEmitter.call(this);

  this.buffer = "";
  this.msgHandlerQueue = [];
  this.idling = false;
}
util.inherits(MpdClient, EventEmitter);

var defaultConnectOpts = {
  host: 'localhost',
  port: 6600
}

/**
 * Connects to a MPD server
 *
 * @returns {MPDClient}
 * @param {Object?} options options to 
 *  [connect to a socket]{@link https://nodejs.org/api/net.html#net_socket_connect_options_connectlistener}
 * @memberof MPDClient
 * @name connect
 */
MpdClient.connect = function(options) {
  options = options || defaultConnectOpts;

  var client = new MpdClient();

  /**
   * @member {Socket}
   * @name socket
   * @memberof MPDClient
   * @see {@link https://nodejs.org/api/net.html#net_class_net_socket}
   */
  client.socket = net.connect(options, function() {
    client.emit('connect');
  });
  client.socket.setEncoding('utf8');
  client.socket.on('data', function(data) {
    client.receive(data);
  });
  client.socket.on('close', function() {
    client.emit('end');
  });
  client.socket.on('error', function(err) {
    client.emit('error', err);
  });
  return client;
}

MpdClient.prototype.receive = function(data) {
  var m;
  this.buffer += data;
  while (m = this.buffer.match(MPD_SENTINEL)) {
    var msg = this.buffer.substring(0, m.index)
      , line = m[0]
      , code = m[1]
      , str = m[2]

    if (code === "ACK") {
      this.handleMessage(new MPDError(str))
    } else if (OK_MPD.test(line)) {
      this.setProtoVersion(line)
      this.setupIdling();
    } else {
      this.handleMessage(null, msg);
    }

    this.buffer = this.buffer.substring(msg.length + line.length + 1);
  }
};

MpdClient.prototype.handleMessage = function(err, msg) {
  var handler = this.msgHandlerQueue.shift();
  handler(err, msg);
};

MpdClient.prototype.setupIdling = function() {
  var self = this;
  self.sendWithCallback("idle", function(err, msg) {
    self.handleIdleResultsLoop(err, msg);
  });
  self.idling = true;
  self.emit('ready');
};

MpdClient.prototype.setProtoVersion = function(line) {
  let version = line.split(OK_MPD)[1]
  Object.defineProperty(
    this,
    'PROTOCOL_VERSION',
    { get: () => this.socket.destroyed ? undefined : version }
  )
}

/**
 * Send a command to the MPD server
 *
 * @memberof MPDClient
 * @name MPDClient#sendCommand
 * @function
 * @param {Command|String}
 * @param {Function} callback
 */
MpdClient.prototype.sendCommand = function(command, callback) {
  var self = this;
  callback = callback || noop.bind(this);
  assert.ok(self.idling);
  self.send("noidle\n");
  self.sendWithCallback(command, callback);
  self.sendWithCallback("idle", function(err, msg) {
    self.handleIdleResultsLoop(err, msg);
  });
};

/**
 * Send commands to the MPD server:
 *
 * ```
 * command_list_begin
 * command1
 * command2
 * ...
 * command_list_end
 * ```
 *
 * @memberof MPDClient
 * @name MPDClient#sendCommands
 * @function
 * @param {Array<Command|String>} commandList
 * @param {Function} callback
 */
MpdClient.prototype.sendCommands = function(commandList, callback) {
  var fullCmd = "command_list_begin\n" + commandList.join("\n") + "\ncommand_list_end";
  this.sendCommand(fullCmd, callback || noop.bind(this));
};

MpdClient.prototype.handleIdleResultsLoop = function(err, msg) {
  var self = this;
  if (err) {
    self.emit('error', err);
    return;
  }
  self.handleIdleResults(msg);
  if (self.msgHandlerQueue.length === 0) {
    self.sendWithCallback("idle", function(err, msg) {
      self.handleIdleResultsLoop(err, msg);
    });
  }
};

MpdClient.prototype.handleIdleResults = function(msg) {
  var self = this;
  msg.split("\n").forEach(function(system) {
    if (system.length > 0) {
      var name = system.substring(9);
      self.emit('system-' + name);
      self.emit('system', name);
    }
  });
};

MpdClient.prototype.sendWithCallback = function(cmd, cb) {
  cb = cb || noop.bind(this);
  this.msgHandlerQueue.push(cb);
  this.send(cmd + "\n");
};

MpdClient.prototype.send = function(data) {
  console.log('sending', data)
  this.socket.write(data);
};


/**
 * Disconnects from the MPD server.
 *
 * Promisified in case if callback is omitted.
 *
 * @memberof MPDClient
 * @name MPDClient#disconnect
 * @param {Function?} cb is omitted, promise is returned
 * @function
 * @returns {Promise|undefined}
 */
MpdClient.prototype.disconnect = function(cb) {
  let self = this

  var promise

  if (typeof cb !== 'function') {
    promise = new Promise((resolve, reject) => {
      cb = resolve
    })
  }

  var notifyClosed = () => {
    cb()
    // noop all other calls
    notifyClosed = () => {}
  }


  if (this.socket.destroyed) {
    setTimeout(notifyClosed, 0)
    return promise
  }

  this.socket.once('close', notifyClosed)
  this.socket.once('end', notifyClosed)

  this.socket.end()
  setTimeout(() => {
    this.socket.destroy()
  }, 16)

  return promise
}

/**
 * @class
 * @classdesc Command halper, correctly serializes commands 
 *   to be sent to the MPD server
 * @memberof MPDClient
 * @constructor
 * @param {String} name
 * @param {Array} args
 */
function Command(name, args) {
  this.name = name;
  this.args = args;
}

Command.prototype.toString = function() {
  return this.name + " " + this.args.map(argEscape).join(" ");
};

function argEscape(arg){
  // replace all " with \"
  return '"' + arg.toString().replace(/"/g, '\\"') + '"';
}

function noop(err) {
  if (err) this.emit('error', err);
}

// convenience
function cmd(name, args) {
  return new Command(name, args);
}

function parseKeyValueMessage(msg) {
  var result = {};

  msg.split('\n').forEach(function(p){
    if(p.length === 0) {
      return;
    }
    var keyValue = p.match(/([^ ]+): (.*)/);
    if (keyValue == null) {
      throw new Error('Could not parse entry "' + p + '"')
    }
    result[keyValue[1]] = keyValue[2];
  });
  return result;
}

function parseArrayMessage(msg) {
  var results = [];
  var obj = {};

  msg.split('\n').forEach(function(p) {
    if(p.length === 0) {
      return;
    }
    var keyValue = p.match(/([^ ]+): (.*)/);
    if (keyValue == null) {
      throw new Error('Could not parse entry "' + p + '"')
    }

    if (obj[keyValue[1]] !== undefined) {
      results.push(obj);
      obj = {};
      obj[keyValue[1]] = keyValue[2];
    }
    else {
      obj[keyValue[1]] = keyValue[2];
    }
  });
  results.push(obj);
  return results;
}


/**
 * There is a problem with the default parseArrayMessage method
 * when parsing song list. If mpd returns
 * MUSICBRAINS_TRACKID: xxx
 * for same song two times (which can be valid as it's found 2 times
 * for the same song) then default parseArrayMessage breaks and
 * returns corrupted entries.
 * Since all songs begin with `file:`
 * this one fits better for song list parsing.
 * @ignore
 */
function parseSongArrayMessage(msg) {
  let results = []
  let obj

  msg.split('\n').forEach(p => {
    if (p.length === 0) {
      return
    }
    let keyValue = p.match(/([^ ]+): (.*)/)
    if (keyValue == null) {
      throw new Error('Could not parse entry "' + p + '"')
    }

    let isnew = keyValue[1].toLowerCase().trim() === 'file'
    if (isnew) {
      if (obj) results.push(obj)
      obj = {}
      obj[keyValue[1]] = keyValue[2]
    } else {
      obj[keyValue[1]] = keyValue[2]
    }
  })

  if (obj) results.push(obj)
  return results
}
