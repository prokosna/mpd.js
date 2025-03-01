import { MPDError } from './error'

let NORMALIZE_KEYS = true
let AUTOPARSE_VALUES = true

// Type definitions
export interface ParsedAudio {
  sample_rate: number
  bits: number
  channels: number
  sample_rate_short?: {
    value: number
    unit: string
  }
  original_value: string
}

export interface ParsedTime {
  elapsed: number
  total: number
}

export interface ShortUnitResult {
  value: number
  unit: string
}

export interface ParseListMemo<T = any> {
  delims: Record<string, boolean> | null
  current: T | null
  list: T[]
}

export interface ParseNestedListMemo<T = any> {
  objpath: T[]
  keypath: string[]
  list: T[]
  delims: Record<string, boolean> | null
}

export interface ParseListAndAccumulateMemo<T = any> {
  objpath: T[]
  list: T[]
}

// Basic utilities
export const isString = (val: unknown): val is string => typeof val === 'string'
export const isNumber = (val: unknown): val is number => typeof val === 'number'

export const isNonEmptyString = (val: unknown): boolean =>
  isString(val) && !!val.trim().length

export const escapeArg = (arg: string | number): string => {
  const escaped = String(arg).replace(/"/g, '\\"')
  return `"${escaped}"`
}

export const normalizeKeys = (val?: boolean): boolean => {
  if (typeof val === 'boolean') {
    NORMALIZE_KEYS = val
  }
  return NORMALIZE_KEYS
}

export const autoparseValues = (val?: boolean): boolean => {
  if (typeof val === 'boolean') {
    AUTOPARSE_VALUES = val
  }
  return AUTOPARSE_VALUES
}

/**
 * Parse lines, first key represents
 * a distinct object
 *
 * parseList(`
 * file: some/path
 * meta: meta
 * foo: bar
 * file: some/other/path
 * `) => [ {file: 'some/path', meta: 'meta', foo: 'bar'},
 *       { file: 'some/other/path }]
 *
 * pass delimiters in order to set distinct keys:
 * (without 'playlist' delimiter, key-vals would be
 * attached to frist file object):
 *
 * parseList(`
 * file: some/path
 * meta: meta
 * playlist: playlist name
 * modified: some-date
 * file: some/other/path
 * `, ['file', 'playlist']
 * ) => [ {file: 'some/path', meta: 'meta'},
 *        {playlist: 'playlist name', modified: 'some-date'},
 *        {file: 'some/other/path'}
 *     ]
 */
export const parseList = <T = Record<string, any>>(msg: string, delimiters?: string | string[] | Record<string, boolean>): T[] => msg
  .split('\n')
  .reduce((memo: ParseListMemo<T>, line: string) => {
    if (ignoreLine(line)) {
      return memo
    }

    const [key, val] = mpdLine2keyVal(line)

    // is new entry?
    const isNew = !memo.current
      ? true
      : memo.delims !== null
        ? memo.delims[key]
        : memo.current[key as keyof T] !== undefined

    if (isNew) {
      memo.current = {} as T
      memo.list.push(memo.current)
    }

    // if current already has this key,
    // then make it a list of values
    const currentKey = key as keyof T
    if (memo.current[currentKey] === undefined) {
      memo.current[currentKey] = val as T[keyof T]
    } else if (memo.current[currentKey] !== val) {
      if (!Array.isArray(memo.current[currentKey])) {
        memo.current[currentKey] = [memo.current[currentKey]] as T[keyof T]
      }
      (memo.current[currentKey] as any[]).push(val)
    }

    return memo
  }, {
    delims: delimiters2object(delimiters),
    current: null,
    list: []
  } as ParseListMemo<T>)
  .list

parseList.by = <T = Record<string, any>>(...delimiters: (string | string[] | Record<string, boolean>)[]) => {
  if (Array.isArray(delimiters) && delimiters.length === 1) {
    delimiters = delimiters[0] as string[]
  }
  const delimsObj = delimiters2object(delimiters[0])
  return (msg: string): T[] => parseList<T>(msg, delimsObj)
}

/**
 * Parse the list, first item key indicates
 * the unique key identifier, any subtiems
 * will be nested within that object:
 * artist: foo
 * album: foo
 * title: bar
 * title: fox
 * title: jumps
 * album: crazy
 * title: mind
 * artist: cactus
 * ablum: cactusalbum
 * title: bull
 * =>
 * [ { artist: 'foo',
 *     album:
 *      [ { album: 'foo',
 *          title:
 *           [ { title: 'bar' },
 *             { title: 'fox' },
 *             { title: 'jumps' },
 *             { title: 'mind' } ] },
 *        { album: 'crazy' } ] },
 *   { artist: 'cactus',
 *     ablum: [ { ablum: 'cactusalbum', title: [ { title: 'bull' } ] } ] } ]
 */
export const parseObject = <T = Record<string, any>>(msg: string): T | undefined =>
  parseList<T>(msg)[0]

/**
 * Parse the list, first item key indicates
 * the unique key identifier, any subtiems
 * will be nested within that object:
 * artist: foo
 * album: foo
 * title: bar
 * title: fox
 * title: jumps
 * album: crazy
 * title: mind
 * artist: cactus
 * ablum: cactusalbum
 * title: bull
 * =>
 * [ { artist: 'foo',
 *     album:
 *      [ { album: 'foo',
 *          title:
 *           [ { title: 'bar' },
 *             { title: 'fox' },
 *             { title: 'jumps' },
 *             { title: 'mind' } ] },
 *        { album: 'crazy' } ] },
 *   { artist: 'cactus',
 *     ablum: [ { ablum: 'cactusalbum', title: [ { title: 'bull' } ] } ] } ]
 */
export const parseNestedList = <T = Record<string, any>>(msg: string): T[] => msg
  .split('\n')
  .reduce((memo: ParseNestedListMemo<T>, line: string) => {
    if (ignoreLine(line)) {
      return memo
    }

    let target: T[]
    const [key, val] = mpdLine2keyVal(line)
    const obj = { [key]: val } as T

    if (!memo.delims) {
      memo.delims = { [key]: true }
    }

    // is this new entry of default type
    if (memo.delims[key]) {
      memo.objpath = [obj]
      memo.keypath = [key]
      target = memo.list
    } else {
      const kpos = memo.keypath.indexOf(key)

      // first entry of this sub type into the
      // current item
      if (kpos === -1) {
        target = []
        ;(memo.objpath[memo.objpath.length - 1] as any)[key] = target
        memo.objpath.push(obj)
        memo.keypath.push(key)
      } else {
        target = (memo.objpath[kpos - 1] as any)[key]
      }
    }

    target.push(obj)

    return memo
  }, {
    delims: null as Record<string, boolean> | null,
    objpath: [] as T[],
    keypath: [] as string[],
    list: [] as T[]
  })
  .list

/**
 * @param {Array<string>} path to accumulate
 * parseListAndAccumulate(['directory', 'file'])(`
 * directory: foo
 * file: bar
 * something: else
 * file: fox
 * meta: atem
 * title: cool song
 * fileblah: fileblah
 * filenlahmeta: fbm
 * filenlahmeta: same keys as array
 * directory: bar
 * file: hello
 * title: hello song
 * `) =>
 * [ { directory: 'foo',
 *     file:
 *      [ { file: 'bar', something: 'else' },
 *        { file: 'fox',
 *          meta: 'atem',
 *          title: 'cool song',
 *          fileblah:
 *           [ { fileblah: 'fileblah',
 *               filenlahmeta: [ 'fbm', 'same keys as array' ] } ] } ] },
 *   { directory: 'bar',
 *     file: [ { file: 'hello', title: 'hello song' } ] } ]
 */
export const parseListAndAccumulate = (path: string[]) => <T = Record<string, any>>(msg: string): T[] => msg
  .split('\n')
  .reduce((memo: ParseListAndAccumulateMemo<T>, line: string) => {
    if (ignoreLine(line)) {
      return memo
    }

    const [key, val] = mpdLine2keyVal(line)
    const obj = { [key]: val } as T
    const keyIdx = path.indexOf(key)

    // new top entry
    if (keyIdx === 0) {
      memo.list.push(obj)
      memo.objpath = [obj]
    } else if (keyIdx !== -1) {
      const parent = memo.objpath[keyIdx - 1] as any
      if (parent[key] === undefined) {
        parent[key] = []
      }

      parent[key].push(obj)
      memo.objpath[keyIdx] = obj

      // use array.length = x to remove all items
      // further than position x, this is for when
      // we're returning form a subobject and need
      // to remove all deeper pointer objects in the
      // memo.objpath
      if (memo.objpath.length > keyIdx + 1) {
        memo.objpath.length = keyIdx + 1
      }

    // insert key-val to the last object
    } else {
      const target = memo.objpath[memo.objpath.length - 1] as any
      if (target[key] === undefined) {
        target[key] = val
      } else if (target[key] !== val) {
        if (Array.isArray(target[key])) {
          target[key].push(val)
        } else {
          target[key] = [target[key], val]
        }
      }
    }

    return memo
  }, {
    objpath: [],
    list: []
  } as ParseListAndAccumulateMemo<T>)
  .list

// Internal utilities
const delimiters2object = (delimiters?: string | string[] | Record<string, boolean>): Record<string, boolean> | null => {
  if (typeof delimiters === 'string') {
    return { [delimiters]: true }
  }
  if (Array.isArray(delimiters)) {
    return delimiters.reduce((delims, key) => ({ ...delims, [key]: true }), {})
  }
  if (typeof delimiters === 'object' && delimiters != null) {
    return delimiters
  }
  return null
}

const mpdLine2keyVal = (line: string): [string, any] => {
  const keyValue = line.match(/([^ ]+): (.*)/)

  if (keyValue == null) {
    throw new MPDError('Could not parse entry', 'EPARSE', line)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_, key, val] = keyValue

  const normalizedKey = NORMALIZE_KEYS ? normalizeKey(key) : key
  const parsedVal = AUTOPARSE_VALUES ? autoParse(normalizedKey, val) : val

  return [normalizedKey, parsedVal]
}

const ignoreLine = (line: string): boolean =>
  line.trim().length === 0 || line === 'OK'

const normalizeKey = (key: string): string =>
  key.toLowerCase().replace(/[^a-z_]/g, '_')

const autoParse = (key: string, val: string): any =>
  VAL_PARSERS[key as keyof typeof VAL_PARSERS]
    ? VAL_PARSERS[key as keyof typeof VAL_PARSERS](val)
    : val

const parsers = {
  parseInt(num: string | number): number {
    const val = Number.parseInt(String(num))
    return Number.isNaN(val) ? 0 : val
  },

  tryParseInt(num: string | number): number | string {
    const val = Number.parseInt(String(num))
    return val.toString() === String(num) ? val : num
  },

  parseFloat(num: string | number): number {
    const val = Number.parseFloat(String(num))
    return Number.isNaN(val) ? 0 : val
  },

  parseBool(val: unknown): boolean {
    if (typeof val === 'boolean') return val
    if (val === 1) return true
    if (val === 0) return false

    if (typeof val === 'string') {
      const normalized = val.toLowerCase().trim()
      return normalized === 'true' || normalized === '1' || normalized === 'on'
    }
    return false
  },

  parseSingleFlag(val: unknown): 'oneshot' | boolean {
    if (String(val).toLowerCase() === 'oneshot') {
      return 'oneshot'
    }
    return parsers.parseBool(val)
  },

  parseTime(val: string): ParsedTime | number {
    if (!val.includes(':')) {
      return parsers.parseInt(val)
    }
    const [elapsed, total] = val.split(':').map(parsers.parseInt)
    return { elapsed, total }
  },

  parseAudio(val: string): ParsedAudio {
    const [sampleRate, bits, channels] = val
      .split(':').map(parsers.tryParseInt)

    const result: ParsedAudio = {
      sample_rate: sampleRate as number,
      bits: bits as number,
      channels: channels as number,
      original_value: val
    }

    if (isNumber(sampleRate)) {
      const srs = parsers.toShortUnit(sampleRate)
      srs.unit += 'Hz'
      result.sample_rate_short = srs
    }

    return result
  },

  parseBitrateKBPS(val: string | number): { value: number; unit: string } {
    const bitrate = parsers.parseInt(val)
    return {
      value: bitrate,
      unit: 'kbps'
    }
  },

  /**
   * Shorten the number using a unit (eg. 1000 = 1k)
   * @param {Number} num number to shorten
   * @param {Number} [digits=`${num}`.length] will be used with toFixed
   * @returns {module:parser~ShortUnitResult}
   */
  toShortUnit(num: number, digits?: number): ShortUnitResult {
    if (!isNumber(digits)) {
      digits = String(num).length
    }

    const si = [
      { value: 1, symbol: '' },
      { value: 1E3, symbol: 'k' },
      { value: 1E6, symbol: 'M' },
      { value: 1E9, symbol: 'G' },
      { value: 1E12, symbol: 'T' },
      { value: 1E15, symbol: 'P' },
      { value: 1E18, symbol: 'E' }
    ]

    const rx = /\.0+$|(\.[0-9]*[1-9])0+$/
    let ii
    for (ii = si.length - 1; ii > 0; ii--) {
      if (num >= si[ii].value) {
        break
      }
    }

    return {
      value: parsers.parseFloat(
        (num / si[ii].value)
          .toFixed(digits)
          .replace(rx, '$1')
      ),
      unit: si[ii].symbol
    }
  }
}

const VAL_PARSERS: Record<string, (val: string) => any> = {
  // file
  format: parsers.parseAudio,

  // song
  duration: parsers.parseFloat,
  time: parsers.parseTime,
  track: parsers.parseFloat,
  disc: parsers.parseInt,
  originaldate: parsers.parseInt,

  // playlist related meta data
  prio: parsers.parseInt,
  id: parsers.parseInt,
  pos: parsers.parseInt,

  // status
  volume: parsers.parseInt,
  songid: parsers.parseInt,
  nextsongid: parsers.parseInt,
  playlistlength: parsers.parseInt,
  playlist: parsers.tryParseInt,
  song: parsers.parseInt,
  nextsong: parsers.parseInt,
  bitrate: parsers.parseBitrateKBPS,
  updating_db: parsers.parseInt,

  elapsed: parsers.parseFloat,
  mixrampdb: parsers.parseFloat,
  mixrampdelay: parsers.parseFloat,
  xfade: parsers.parseFloat,

  repeat: parsers.parseBool,
  random: parsers.parseBool,
  consume: parsers.parseBool,

  single: parsers.parseSingleFlag,
  audio: parsers.parseAudio,

  // stats
  artists: parsers.parseInt,
  albums: parsers.parseInt,
  songs: parsers.parseInt,
  uptime: parsers.parseInt,
  db_playtime: parsers.parseInt,
  db_update: parsers.parseInt,
  playtime: parsers.parseInt,

  // outputs
  outputid: parsers.tryParseInt,
  outputenabled: parsers.parseBool,

  // queue
  cpos: parsers.tryParseInt,

  // ls related
  size: parsers.tryParseInt,

  // albumart
  binary: parsers.tryParseInt
}
