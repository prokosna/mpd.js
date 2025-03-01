import {
  isString,
  isNonEmptyString,
  escapeArg,
  parseList,
  parseObject,
  parseListAndAccumulate,
  parseNestedList,
  normalizeKeys,
  autoparseValues
} from '../lib/parsers'

describe('parsers', () => {
  describe('string utilities', () => {
    it('should check if value is string', () => {
      expect(isString('')).toBe(true)
      expect(isString('foo')).toBe(true)
      expect(isString(null)).toBe(false)
      expect(isString(undefined)).toBe(false)
      expect(isString(123)).toBe(false)
      expect(isString({})).toBe(false)
    })

    it('should check if string is non-empty', () => {
      expect(isNonEmptyString('')).toBe(false)
      expect(isNonEmptyString('foo')).toBe(true)
      expect(isNonEmptyString(null)).toBe(false)
      expect(isNonEmptyString(undefined)).toBe(false)
    })

    it('should escape arguments properly', () => {
      expect(escapeArg('foo')).toBe('"foo"')
      expect(escapeArg('foo bar')).toBe('"foo bar"')
      expect(escapeArg('foo "bar"')).toBe('"foo \\"bar\\""')
    })
  })

  describe('parseObject', () => {
    it('should parse single object', () => {
      const input = 'volume: 50\nrepeat: 1\nrandom: 0\nstate: play\n'
      const result = parseObject(input)
      expect(result).toEqual({
        volume: 50,
        repeat: true,
        random: false,
        state: 'play'
      })
    })

    it('should handle boolean values', () => {
      const input = 'repeat: 1\nrandom: 0\nsingle: 1\nconsume: 0\n'
      const result = parseObject(input)
      expect(result).toEqual({
        repeat: true,
        random: false,
        single: true,
        consume: false
      })
    })

    it('should return undefined for empty input', () => {
      expect(parseObject('')).toBeUndefined()
    })
  })

  describe('parseList', () => {
    it('should parse simple key-value pairs', () => {
      const input = 'file: song1.mp3\nTitle: Song 1\nArtist: Artist 1\n\nfile: song2.mp3\nTitle: Song 2\nArtist: Artist 2\n'
      const result = parseList(input, ['file'])
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        file: 'song1.mp3',
        title: 'Song 1',
        artist: 'Artist 1'
      })
    })

    it('should parse multiple objects separated by delimiter', () => {
      const input = 'directory: dir1\nLast-Modified: 2024-01-24\n\ndirectory: dir2\nLast-Modified: 2024-01-24\n'
      const result = parseList(input, ['directory'])
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        directory: 'dir1',
        last_modified: '2024-01-24'
      })
    })

    it('should handle empty input', () => {
      expect(parseList('', ['file'])).toEqual([])
    })
  })

  describe('parseListAndAccumulate', () => {
    it('should parse and accumulate nested objects', () => {
      const input = `directory: Music
Last-Modified: 2024-01-24
file: song1.mp3
Title: Song 1
Artist: Artist 1

directory: Music/Rock
Last-Modified: 2024-01-24
file: song2.mp3
Title: Song 2
Artist: Artist 2
`
      const parser = parseListAndAccumulate(['directory', 'file'])
      const result = parser(input)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        directory: 'Music',
        last_modified: '2024-01-24',
        file: [{
          file: 'song1.mp3',
          title: 'Song 1',
          artist: 'Artist 1'
        }]
      })
    })
  })

  describe('parseNestedList', () => {
    it('should parse nested list structure', () => {
      const input = `artist: foo
album: foo
title: bar
title: fox
title: jumps
album: crazy
title: mind
artist: cactus
album: cactusalbum
title: bull`
      const result = parseNestedList(input)
      expect(result).toEqual([
        {
          artist: 'foo',
          album: [
            {
              album: 'foo',
              title: [
                { title: 'bar' },
                { title: 'fox' },
                { title: 'jumps' }
              ]
            },
            {
              album: 'crazy',
              title: [
                { title: 'mind' }
              ]
            }
          ]
        },
        {
          artist: 'cactus',
          album: [
            {
              album: 'cactusalbum',
              title: [
                { title: 'bull' }
              ]
            }
          ]
        }
      ])
    })
  })

  describe('parser options', () => {
    it('should normalize keys', () => {
      const wasNormalized = normalizeKeys()
      normalizeKeys(true)
      const input = 'Last-Modified: 2024-01-24\nArtistName: Test\n'
      const result = parseObject(input)
      expect(result).toEqual({
        last_modified: '2024-01-24',
        artistname: 'Test'
      })
      normalizeKeys(wasNormalized)
    })

    it('should autoparse values', () => {
      const wasAutoparsed = autoparseValues()
      autoparseValues(true)
      const input = 'volume: 50\nrepeat: 1\ntime: 123\n'
      const result = parseObject(input)
      expect(result).toEqual({
        volume: 50,
        repeat: true,
        time: 123
      })
      autoparseValues(wasAutoparsed)
    })
  })
})
