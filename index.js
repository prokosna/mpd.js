var EventEmitter = require('events').EventEmitter
  , util = require('util')
  , assert = require('assert')
  , net = require('net')
  , MPD_SENTINEL = /^(OK|ACK|list_OK)(.*)$/m
  , OK_MPD = /^OK MPD /

module.exports = MpdClient;
MpdClient.Command = Command
MpdClient.cmd = cmd;
MpdClient.parseKeyValueMessage = parseKeyValueMessage;
MpdClient.parseArrayMessage = parseArrayMessage;
MpdClient.parseSongArrayMessage = parseSongArrayMessage;

MpdClient.ACK_ERROR_CODES = {
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
};

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

MpdClient.connect = function(options) {
  options = options || defaultConnectOpts;

  var client = new MpdClient();
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
  this.socket.write(data);
};


/**
 * Send disconnect command to the MPD server
 * and wait until connection is closed.
 *
 * if `cb` is omitted, promise is returned
 */
MpdClient.prototype.disconnect = function(cb) {
  let self = this

  var promise
  var ftid

  if (typeof cb !== 'function') {
    promise = new Promise((resolve, reject) => {
      cb = resolve
    })
  }

  var notifyClosed = () => {
    clearTimeout(ftid)
    cb()
    // noop all other calls
    notifyClosed = () => {}
  }


  if (this.socket.destroyed) {
    setTimeout(notifyClosed, 0)
    return promise
  }

  // force close if needed
  ftid = setTimeout(function () {
    if (self.socket.destroyed) {
      return
    }
    self.socket.destroy()
  }, 4000)

  this.socket.once('close', notifyClosed)
  this.socket.once('end', notifyClosed)

  // if we're connected; meaning we can write and are not in `connecting` state
  // then send the `close` command to the server
  if (this.socket.writable && !this.socket.connecting) {
    this.sendWithCallback('close')
  } else {
    this.socket.destroy()
  }

  return promise
}

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
