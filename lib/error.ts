import debug from 'debug'
import { PACKAGE_NAME } from './const'

const debugLog = debug(`${PACKAGE_NAME}:error`)

export enum MPDErrorCode {
  /** 1 */
  NOT_LIST = 1,
  /** 2 */
  ARG = 2,
  /** 3 */
  PASSWORD = 3,
  /** 4 */
  PERMISSION = 4,
  /** 5 */
  UNKNOWN = 5,
  /** 50 */
  NO_EXIST = 50,
  /** 51 */
  PLAYLIST_MAX = 51,
  /** 52 */
  SYSTEM = 52,
  /** 53 */
  PLAYLIST_LOAD = 53,
  /** 54 */
  UPDATE_ALREADY = 54,
  /** 55 */
  PLAYER_SYNC = 55,
  /** 56 */
  EXIST = 56
}

const CODES_REVERSED: { [key: number]: string } = Object.entries(MPDErrorCode)
  .filter(([key]) => Number.isNaN(Number(key)))
  .reduce((memo, [key, value]) => ({ ...memo, [value]: key }), {})

export class MPDError extends Error {
  readonly code: string
  readonly errno?: number
  readonly cmd_list_num?: number
  readonly current_command?: string
  readonly info?: unknown

  constructor(str: string, code?: string | number, info?: unknown) {
    super()
    debugLog('new error:', str)
    Error.captureStackTrace(this, this.constructor)

    // error response:
    // ACK [error@command_listNum] {current_command} message_text

    // parse error and command_listNum
    const errCode = str.match(/\[(.*?)\]/)
    this.name = 'MPDError'

    // safety fallback just in case
    if (!errCode || !errCode.length) {
      this.message = str
      this.code = code?.toString() || str
    } else {
      const [error, cmdListNum] = errCode[1].split('@')
      const currentCommand = str.match(/{(.*?)}/)
      const msg = str.split('}')[1].trim()

      this.code = CODES_REVERSED[Number(error)] || '??'
      this.errno = Number(error)
      this.message = msg
      this.cmd_list_num = Number(cmdListNum)
      this.current_command = currentCommand?.[1]
    }

    if (info) {
      this.info = info
    }
  }

  static readonly CODES = MPDErrorCode
  static readonly CODES_REVERSED = CODES_REVERSED
}

export const isError = (responseLine: string): MPDError | null =>
  responseLine.startsWith('ACK')
    ? new MPDError(responseLine)
    : null
