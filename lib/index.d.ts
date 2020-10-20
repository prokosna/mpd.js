/// <reference types="node" />

import { NetConnectOpts, Socket } from 'net';
import { EventEmitter } from 'events';

declare const mpd: typeof MPD.Client;


export declare namespace MPD {

  export type Config = NetConnectOpts & {
    password?: string,
  }

  class Client extends EventEmitter {
    static connect(config?: MPD.Config): Promise<MPD.Client>;
    static MPDError: typeof MPDError;
    static Command: typeof Command;
    static cmd: typeof Command.cmd;
    static normalizeKeys: typeof Parsers.normalizeKeys;
    static autoparseValues: typeof Parsers.autoparseValues;

    /**
     * Do not use directly, use mpd.connect(config) instead.
     */
    constructor (config?: MPD.Config);

    /**
     * Underlaying socket connected to MPD.
     * Available after connect.
     */
    socket: Socket;

    /**
     * Sends a MPD command string
     */
    sendCommand (command: string): Promise<string>;

    /**
     * Sends multiple MPD commands wrapped between command list begin and end
     * @example
     *  command_list_begin
     *  commands.join('\n')
     *  command_list_end
     *
     */
    sendCommands (commands: string[]): Promise<string>;

    setupIdling (): void;
    stopIdling (): void;

    /**
     * Directly writes to socket connected to MPD
     */
    send(data: string): void;

    disconnect(): Promise<void>;
  }

  class MPDError extends Error {
    code: number;
    errno: MPDError.CODES;
    /**
     * Which command failed in case multiple commands were sent.
     * 0 for first (or only) command.
     */
    cmd_list_num: number;
    message: string;
    /**
     * Which command failed in case multiple commands were sent.
     */
    current_command: string;
    info?: string;

    /**
     * Checks whether line represents MPD error line
     */
    static isError: (line: string) => boolean;
  }

  namespace MPDError {

    enum CODES {
      NOT_LIST = 1,
      ARG = 2,
      PASSWORD = 3,
      PERMISSION = 4,
      UNKNOWN = 5,
      NO_EXIST = 50,
      PLAYLIST_MAX = 51,
      SYSTEM = 52,
      PLAYLIST_LOAD = 53,
      UPDATE_ALREADY = 54,
      PLAYER_SYNC = 55,
      EXIST = 56
    }
  }

  class Command {
    constructor(name: string, args?: string[]);
    constructor(name: string, ...args: string[]);

    name: string;
    args: string[];

    /**
     * Helpful command for sending commands to MPD server.
     * Takes care of escaping arguments on protocol level.
     *
     * @example
     *  client.sendCommand(
     *    mpd.cmd('search', ['(artist contains "Empire")', 'group', 'album'])
     *  )
     */
    static cmd (name: string, args?: string[]): Command;

    /**
     * Helpful command for sending commands to MPD server.
     * Takes care of escaping arguments on protocol level.
     *
     * @example
     *  client.sendCommand(
     *    mpd.cmd('search', '(artist contains "Empire")', 'group', 'album')
     *  )
     */
    static cmd (name: string, ...args: string[]): Command;
  }

  namespace Parsers {

    /**
     * Whether parser functions format all keys into `snake_case` or not.
     * (MPD is not consistant in this aspect)
     * Default = true
     *
     * If `enabled` flag is omitted, method is used as a getter.
     */
    export const normalizeKeys: (enabled?: boolean) => boolean;

    /**
     * Whether to parse values for known keys (like bitrate, song ids, positions etc..)
     * Default = true
     *
     * If `enabled` flag is omitted, method is used as a getter.
     */
    export const autoparseValues: (enabled?: boolean) => boolean;
  }

}

export default mpd;
