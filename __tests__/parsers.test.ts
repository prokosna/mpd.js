const {
  isString,
  isNonEmptyString,
  escapeArg,
  parseList,
  parseObject,
  normalizeKeys,
  autoparseValues
} = require('../lib/parsers')

describe('parsers', () => {
  describe('string utilities', () => {
    test('should check if value is string', () => {
      expect(isString('test')).toBe(true)
      expect(isString(123)).toBe(false)
      expect(isString(null)).toBe(false)
    })

    test('should check if string is non-empty', () => {
      expect(isNonEmptyString('test')).toBe(true)
      expect(isNonEmptyString('')).toBe(false)
      expect(isNonEmptyString(' ')).toBe(false)
    })

    test('should escape arguments properly', () => {
      expect(escapeArg('test')).toBe('"test"')
      expect(escapeArg('test "quoted"')).toBe('"test \\"quoted\\""')
    })
  })

  describe('parseList', () => {
    beforeEach(() => {
      normalizeKeys(true)
      autoparseValues(true)
    })

    test('should parse simple key-value pairs', () => {
      const input = 'name: Test\nartist: Artist\nalbum: Album'
      const expected = [{
        name: 'Test',
        artist: 'Artist',
        album: 'Album'
      }]
      expect(parseList(input)).toEqual(expected)
    })

    test('should parse multiple objects separated by delimiter', () => {
      const input = 'file: song1.mp3\ntitle: Song 1\nfile: song2.mp3\ntitle: Song 2'
      const expected = [
        { file: 'song1.mp3', title: 'Song 1' },
        { file: 'song2.mp3', title: 'Song 2' }
      ]
      expect(parseList(input, ['file'])).toEqual(expected)
    })

    test('should handle empty input', () => {
      expect(parseList('')).toEqual([])
    })

    test('should throw error on malformed input', () => {
      const input = 'invalid line\nkey: value'
      expect(() => parseList(input)).toThrow('Could not parse entry')
    })
  })

  describe('parseObject', () => {
    test('should parse single object', () => {
      const input = 'name: Test\nvalue: 123'
      const expected = { name: 'Test', value: "123" }
      expect(parseObject(input)).toEqual(expected)
    })

    test('should return undefined for empty input', () => {
      expect(parseObject('')).toBeUndefined()
    })
  })
})
