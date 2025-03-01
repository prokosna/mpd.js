import mpd, { MPDClient } from '../lib'
import { MPDError } from '../lib/error'
import { Command } from '../lib/command'

describe('MPD Client Integration Tests', () => {
  let client: MPDClient

  beforeAll(async () => {
    // Note: These tests require a running MPD server
    client = await mpd.connect({
      host: process.env.MPD_HOST || 'localhost',
      port: parseInt(process.env.MPD_PORT || '6600', 10)
    })
  })

  afterAll(async () => {
    if (client) {
      await client.disconnect()
    }
  })

  describe('Connection', () => {
    it('should connect to MPD server', () => {
      expect(client.PROTOCOL_VERSION).toBeDefined()
    })

    it('should handle connection errors', async () => {
      await expect(mpd.connect({
        host: 'invalid-host',
        port: 6600
      })).rejects.toThrow()
    }, 10000) // Increase timeout to 10 seconds
  })

  describe('Commands', () => {
    it('should send single command', async () => {
      const status = await client.sendCommand('status')
      const result = mpd.parseObject(status)
      expect(result).toHaveProperty('volume')
      expect(result).toHaveProperty('state')
    })

    it('should send command with arguments', async () => {
      const command = Command.cmd('setvol', [50])
      await expect(client.sendCommand(command)).resolves.not.toThrow()
    })

    it('should send multiple commands', async () => {
      const commands = [
        'status',
        Command.cmd('setvol', [60])
      ]
      await expect(client.sendCommands(commands)).resolves.not.toThrow()
    })

    it('should handle command errors', async () => {
      try {
        await client.sendCommand(Command.cmd('invalid_command'))
      } catch (e) {
        const err = e as MPDError
        expect(err.code).toBe('UNKNOWN')
        expect(err.errno).toBe(MPDError.CODES.UNKNOWN)
      }
    })
  })

  describe('Events', () => {
    it('should emit system events by play', (done) => {
      const handler = (name: string) => {
        expect(typeof name).toBe('string')
        client.off('system', handler)
        done()
      }
      client.on('system', handler)
      client.sendCommand(Command.cmd('play')).catch(done)
    })

    it('should emit system events by pause', (done) => {
      const handler = (name: string) => {
        expect(typeof name).toBe('string')
        client.off('system', handler)
        done()
      }
      client.on('system', handler)
      client.sendCommand(Command.cmd('pause')).catch(done)
    })

    it('should emit close event', (done) => {
      const newClient = mpd.connect()
      newClient.then(client => {
        client.on('close', done)
        client.disconnect()
      })
    })
  })

  describe('Parsers', () => {
    it('should parse status response', async () => {
      const status = await client.sendCommand('status').then(mpd.parseObject)
      expect(typeof status?.volume).toBe('number')
      expect(typeof status?.repeat).toBe('boolean')
      expect(['play', 'stop', 'pause']).toContain(status?.state)
    })

    it('should parse list response', async () => {
      const listAll = await client.sendCommand('listall')
        .then(mpd.parseList.by('file'))
      expect(Array.isArray(listAll)).toBe(true)
      expect(listAll[0]).toHaveProperty('file')
    })

    it('should parse status information with audio format', async () => {
      const status = await client.sendCommand('status')
        .then(mpd.parseObject)
      
      expect(status).toBeDefined()
      if (!status) return
      expect(typeof status).toBe('object')
      
      const commonProps = ['volume', 'repeat', 'random', 'single', 'consume', 'playlist']
      const hasCommonProps = commonProps.some(prop => prop in status)
      expect(hasCommonProps).toBe(true)
      
      expect(typeof status.audio).toBe('object')
      expect(status.audio).toHaveProperty('sample_rate')
      expect(status.audio).toHaveProperty('bits')
      expect(status.audio).toHaveProperty('channels')
        
      if (status.audio.sample_rate_short) {
        expect(status.audio.sample_rate_short).toHaveProperty('value')
        expect(status.audio.sample_rate_short).toHaveProperty('unit')
        expect(status.audio.sample_rate_short.unit).toContain('Hz')
      }
    })

    it('should execute multiple commands in a command list', async () => {
      const commands = [
        'status',
        Command.cmd('stats')
      ]
      
      const result = await client.sendCommands(commands)
      
      const lines = result.split('\n')
      
      expect(lines.some(line => line.startsWith('volume:'))).toBe(true)
      expect(lines.some(line => line.startsWith('artists:'))).toBe(true)
    })

    it('should handle special MPD commands with arguments', async () => {
        const result = await client.sendCommand(
          Command.cmd('search', 'any', 'sample')
        )
        
        const songs = mpd.parseList.by('file')(result)
        expect(Array.isArray(songs)).toBe(true)
        
        // If songs were found, verify their properties
        if (songs.length > 0) {
          const song = songs[0]
          expect(song).toHaveProperty('file')
          // Check for common song metadata
          const metadataKeys = ['title', 'artist', 'album', 'time', 'duration']
          const hasMetadata = metadataKeys.some(key => key in song)
          expect(hasMetadata).toBe(true)
        }
    })
  })
})
