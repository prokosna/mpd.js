import mpd, { MPD } from '../lib'
import { MPDError } from '../lib/error'
import { cmd } from '../lib/command'

describe('MPD Client Integration Tests', () => {
  let client: MPD.Client

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
    })
  })

  describe('Commands', () => {
    it('should send single command', async () => {
      const status = await client.sendCommand('status')
      const result = mpd.parseObject<MPD.Status>(status)
      expect(result).toHaveProperty('volume')
      expect(result).toHaveProperty('state')
    })

    it('should send command with arguments', async () => {
      const command = cmd('setvol', [50])
      await expect(client.sendCommand(command)).resolves.not.toThrow()
    })

    it('should send multiple commands', async () => {
      const commands = [
        'status',
        cmd('setvol', [60])
      ]
      await expect(client.sendCommands(commands)).resolves.not.toThrow()
    })

    it('should handle command errors', async () => {
      try {
        await client.sendCommand(cmd('invalid_command'))
      } catch (e) {
        const err = e as MPDError
        expect(err.code).toBe('UNKNOWN')
        expect(err.errno).toBe(MPDError.CODES.UNKNOWN)
      }
    })
  })

  describe('Events', () => {
    it('should emit system events', (done) => {
      const handler = (name: string) => {
        expect(name).toBe('player')
        client.off('system', handler)
        done()
      }
      client.on('system', handler)
      client.sendCommand(cmd('play')).catch(done)
    })

    it('should emit specific system events', (done) => {
      client.once('system-player', () => {
        done()
      })
      client.sendCommand(cmd('pause')).catch(done)
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
      const status = await client.sendCommand('status').then(mpd.parseObject<MPD.Status>)
      expect(typeof status.volume).toBe('number')
      expect(typeof status.repeat).toBe('boolean')
      expect(['play', 'stop', 'pause']).toContain(status.state)
    })

    it('should parse list response', async () => {
      const listAll = await client.sendCommand('listall')
        .then(mpd.parseList.by('file'))
      expect(Array.isArray(listAll)).toBe(true)
      if (listAll.length > 0) {
        expect(listAll[0]).toHaveProperty('file')
      }
    })

    it('should parse nested list response', async () => {
      const parser = mpd.parseListAndAccumulate<MPD.ListAllInfo>(['directory', 'file'])
      const listAllInfo = await client.sendCommand('listallinfo')
        .then(parser)
      expect(Array.isArray(listAllInfo)).toBe(true)
      if (listAllInfo.length > 0) {
        const first = listAllInfo[0]
        expect(first).toHaveProperty('directory')
        if (first.file) {
          expect(Array.isArray(first.file)).toBe(true)
        }
      }
    })
  })
})
