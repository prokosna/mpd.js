import net from 'net'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import assert from 'assert'
import debug from 'debug'

import { isError, MPDError } from './error'
import {
  isString,
  isNonEmptyString,
  escapeArg,
  parseList,
  parseNestedList,
  parseListAndAccumulate,
  parseObject,
  normalizeKeys,
  autoparseValues
} from './parsers'
import { Command } from './command'
import { PACKAGE_NAME } from './const'

const debugLog = debug(`${PACKAGE_NAME}:error`)

const MPD_SENTINEL = /^(OK|ACK|list_OK)(.*)$/m
const OK_MPD = /^OK MPD /

interface PromiseQueueItem {
  resolve: (value: any) => void
  reject: (reason?: any) => void
}

interface MPDConfig {
  password?: string
  timeout?: number
  path?: string
  host?: string
  port?: number
}

class MPDClient extends EventEmitter {
  protected _config: MPDConfig
  protected _promiseQueue: PromiseQueueItem[]
  protected _buf: string
  protected _idleevts: Record<string, boolean>
  protected _disconnecting: boolean
  protected _idleevtsTID?: NodeJS.Timeout
  public socket!: net.Socket
  public idling: boolean
  public PROTOCOL_VERSION?: string

  constructor(config: MPDConfig) {
    super()
    this._config = config
    this._promiseQueue = []
    this._buf = ''
    this._idleevts = {}
    this._disconnecting = false
    this.idling = false

    // bind to this client
    this.disconnect = this.disconnect.bind(this)
    this._receive = this._receive.bind(this)
    this._handleIdling = this._handleIdling.bind(this)
    this._triggerIdleEvents = this._triggerIdleEvents.bind(this)
  }

  static connect(config?: MPDConfig): Promise<MPDClient> {
    if (!config || typeof config !== 'object') {
      config = getDefaultConfig()
      debugLog('connect: using config %o', config)
    }

    // allow tilde shortcuts if connecting to a socket
    if (isString(config.path) && config.path.startsWith('~')) {
      config.path = config.path.replace(/^~/, os.homedir())
    }

    const netConfig: net.NetConnectOpts = {
      ...config,
      port: config.port,
      host: config.host,
      path: config.path,
      timeout: config.timeout || 2000
    }

    const socket = net.connect(netConfig)
    // Ensure the socket has a timeout set
    socket.setTimeout(netConfig.timeout as number)

    return finalizeClientConnection(
      new MPDClient(config), socket)
  }

  async sendCommand(command: string | Command): Promise<string> {
    assert.ok(this.idling)
    const promise = this._enqueuePromise()
    this.stopIdling()
    this.send(typeof command === 'string' ? command : command.toString())
    this.setupIdling()
    return promise
  }

  async sendCommands(commandList: (string | Command)[]): Promise<string> {
    const cmd = 'command_list_begin\n' +
      commandList.join('\n') +
      '\ncommand_list_end'
    return this.sendCommand(cmd)
  }

  stopIdling(): void {
    if (!this.idling) {
      return
    }
    this.idling = false
    this.send('noidle')
  }

  setupIdling(): void {
    if (this.idling) {
      debugLog('already idling')
      return
    }
    if (this._disconnecting) {
      debugLog('client is being disconnected, ignoring idling setup')
      return
    }
    this.idling = true
    this._enqueuePromise().then(this._handleIdling)
    this.send('idle')
  }

  send(data: string): void {
    if (!this.socket.writable) {
      throw new MPDError('Not connected', 'ENOTCONNECTED')
    }
    debugLog('sending %s', data)
    this.socket.write(data + '\n')
  }

  disconnect(): Promise<void> {
    this._disconnecting = true
    return new Promise((resolve) => {
      if (this.socket && this.socket.destroyed) {
        return resolve()
      }

      let _resolve = () => {
        if (resolve) {
          resolve()
          resolve = null
        }
      }

      this.socket.once('close', _resolve)
      this.socket.once('end', _resolve)

      this.socket.end()
      setTimeout(() => this.socket.destroy(), 32)
    })
  }

  private _enqueuePromise(): Promise<any> {
    return new Promise((resolve, reject) =>
      this._promiseQueue.push({ resolve, reject }))
  }

  private _resolve(msg: string): void {
    const item = this._promiseQueue.shift()
    if (!item) {
      throw new Error('Promise queue is empty')
    }
    item.resolve(msg)
  }

  private _reject(err: Error): void {
    const item = this._promiseQueue.shift()
    if (!item) {
      throw new Error('Promise queue is empty')
    }
    item.reject(err)
  }

  private _receive(data: string): void {
    let matched: RegExpMatchArray | null
    this._buf += data
    while ((matched = this._buf.match(MPD_SENTINEL)) !== null) {
      const msg = this._buf.substring(0, matched.index)
      const line = matched[0]
      const code = matched[1]
      const desc = matched[2]

      code !== 'ACK'
        ? this._resolve(msg || code) // if empty msg, send back OK
        : this._reject(new MPDError(desc))

      this._buf = this._buf.substring(msg.length + line.length + 1)
    }
  }

  private _handleIdling(msg: string): void {
    // store events and trigger with delay,
    // either a problem with MPD (not likely)
    // or this implementation; same events are
    // triggered multiple times (especially mixer)
    if (isNonEmptyString(msg)) {
      const msgs = msg.split('\n').filter(s => s.length > 9)
      for (const msg of msgs) {
        const name = msg.substring(9)
        this._idleevts[name] = true
      }
    }
    if (this._promiseQueue.length === 0) {
      this.idling = false
      this.setupIdling()
    }
    clearTimeout(this._idleevtsTID)
    this._idleevtsTID = setTimeout(this._triggerIdleEvents, 16)
  }

  private _triggerIdleEvents(): void {
    for (const name in this._idleevts) {
      debugLog('triggering %s', name)
      this.emit(`system-${name}`)
      this.emit('system', name)
    }
    this._idleevts = {}
  }

  static readonly MPDError = MPDError
  static readonly Command = Command
  static readonly cmd = Command.cmd
  static readonly parseList = parseList
  static readonly parseNestedList = parseNestedList
  static readonly parseListAndAccumulate = parseListAndAccumulate
  static readonly parseObject = parseObject
  static readonly normalizeKeys = normalizeKeys
  static readonly autoparseValues = autoparseValues
}

const finalizeClientConnection = (client: MPDClient, socket: net.Socket): Promise<MPDClient> =>
  new Promise((resolve, reject) => {
    socket.setEncoding('utf8')
    socket.on('error', reject)

    let protoVersion: string
    let idleCheckTimeout: NodeJS.Timeout
    const config = (client as any)._config as MPDConfig
    const password = isNonEmptyString(config.password)
      ? config.password
      : false

    const onTimeout = () => {
      debugLog('socket timed out')
      try {
        socket.destroy()
      } catch (e) {
        debugLog('socket destroy failed')
      }
      client.emit('close')
      reject(new MPDError('Connection timed out', 'CONNECTION_TIMEOUT'))
    }

    const finalize = () => {
      debugLog('preparing client')

      Object.defineProperty(
        client,
        'PROTOCOL_VERSION',
        { get: () => socket.destroyed ? undefined : protoVersion }
      )

      if (password) {
        delete (client as any)._config.password
      }

      socket.removeListener('data', onData)
      socket.removeListener('timeout', onTimeout)
      socket.on('data', (client as any)._receive.bind(client))
      socket.on('close', () => {
        debugLog('close')
        client.emit('close')
      })

      client.socket = socket

      client.setupIdling()
      resolve(client)
    }

    const onData = (data: string) => {
      // expected MPD proto response
      if (!MPD_SENTINEL.test(data)) {
        debugLog('invalid server response %s', data)
        reject(new MPDError('Unexpected MPD service response',
          'INVALIDMPDSERVICE', `got: '${data}'`))
        return
      }

      // initial response with proto version
      if (OK_MPD.test(data) && !protoVersion) {
        protoVersion = data.split(OK_MPD)[1]
        debugLog('connected to MPD server, proto version: %s', protoVersion)
        // check for presence of the password
        if (password) {
          debugLog('sending password')
          socket.write(`password ${escapeArg(password)}\n`)
          return
        }
      }

      // check if there was an error (password / idle)
      const error = isError(data)
      if (error) {
        reject(error)
        socket.destroy()
        return
      }

      // do we need to test with the idle?
      if (!idleCheckTimeout) {
        debugLog('idle check')
        // set idle to test for the error for
        // in case MPD requires a password but
        // has not been set
        socket.write('idle\n')
        // idle does not respond, so if there
        // was no error, disable idle to get
        // the response
        idleCheckTimeout = setTimeout(() => {
          socket.write('noidle\n')
        }, 100)

        return
      }

      finalize()
    }

    socket.on('data', onData)
    socket.on('timeout', onTimeout)
  })

const getDefaultConfig = (): MPDConfig => {
  const config: MPDConfig = {}

  const timeout = Number(process.env.MPD_TIMEOUT)
  if (!Number.isNaN(timeout)) {
    config.timeout = timeout
  }

  const socket = [
    process.env.MPD_HOST,
    process.env.XDG_RUNTIME_DIR
      ? path.join(process.env.XDG_RUNTIME_DIR, 'mpd', 'socket')
      : undefined
  ].find(candidate => candidate ? isSocket(candidate) : false)

  if (socket) {
    config.path = socket
  } else {
    config.host = process.env.MPD_HOST || 'localhost'
    config.port = Number(process.env.MPD_PORT) || 6600
  }

  return config
}

const isSocket = (socketPath: string): string | undefined => {
  if (typeof socketPath !== 'string' || socketPath.length === 0) {
    return undefined
  }

  try {
    debugLog('default config: checking if %o is a socket', socketPath)
    if (fs.lstatSync(socketPath).isSocket()) {
      return socketPath
    }
  } catch (e) { }
  return undefined
}

export default MPDClient
export { MPDClient }
