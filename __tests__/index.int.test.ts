import MPDClient from '../lib/index'

describe('MPD Integration Tests', () => {
  let client: typeof MPDClient.prototype

  beforeAll(async () => {
    client = await MPDClient.connect({
      host: 'localhost',
      port: 6600
    })
  })

  afterAll(async () => {
    await client.disconnect()
  })

  describe('Status and Statistics Commands', () => {
    it('should get current status', async () => {
      const response = await client.sendCommand('status')
      expect(response).toContain('volume:')
      expect(response).toContain('repeat:')
      expect(response).toContain('random:')
      expect(response).toContain('single:')
      expect(response).toContain('state:')
    })

    it('should get statistics', async () => {
      const response = await client.sendCommand('stats')
      expect(response).toContain('artists:')
      expect(response).toContain('albums:')
      expect(response).toContain('songs:')
      expect(response).toContain('uptime:')
      expect(response).toContain('playtime:')
    })
  })

  describe('Playback Control Commands', () => {
    it('should control playback state', async () => {
      // Stop playback
      await client.sendCommand('stop')
      let status = await client.sendCommand('status')
      expect(status).toContain('state: stop')

      // Start playback
      await client.sendCommand('play')
      status = await client.sendCommand('status')
      expect(status).toContain('state: play')

      // Pause playback
      await client.sendCommand('pause 1')
      status = await client.sendCommand('status')
      expect(status).toContain('state: pause')
    })

    it('should control volume', async () => {
      const originalVolume = await client.sendCommand('status')
        .then(status => {
          const match = status.match(/volume: (\d+)/)
          return match ? parseInt(match[1], 10) : 50
        })

      // Set volume to 60
      await client.sendCommand('setvol 60')
      let status = await client.sendCommand('status')
      expect(status).toContain('volume: 60')

      // Restore original volume
      await client.sendCommand(`setvol ${originalVolume}`)
    })
  })

  describe('Queue Handling', () => {
    it('should manage playlist queue', async () => {
      // Clear the queue
      await client.sendCommand('clear')
      let status = await client.sendCommand('status')
      expect(status).toContain('playlistlength: 0')

      // Add some tracks (assuming they exist in your library)
      const response = await client.sendCommand('listall')
      const songs = response.split('\n')
        .filter(line => line.startsWith('file:'))
        .slice(0, 2)
        .map(line => line.substring(5).trim())

      if (songs.length > 0) {
        // Add songs to queue
        for (const song of songs) {
          await client.sendCommand(`add "${song}"`)
        }

        status = await client.sendCommand('status')
        expect(parseInt(status.match(/playlistlength: (\d+)/)![1], 10)).toBeGreaterThan(0)

        // Check queue contents
        const playlist = await client.sendCommand('playlist')
        expect(playlist).toContain(songs[0])
      }
    })
  })

  describe('Database Commands', () => {
    it('should search the database', async () => {
      const response = await client.sendCommand('search any ""')
      expect(response.length).toBeGreaterThan(0)
      expect(response).toContain('file:')
    })

    it('should list all songs', async () => {
      const response = await client.sendCommand('listall')
      expect(response.length).toBeGreaterThan(0)
      expect(response).toContain('file:')
    })
  })

  describe('Command List Handling', () => {
    it('should execute multiple commands', async () => {
      const response = await client.sendCommands([
        'status',
        'stats',
        'currentsong'
      ])
      expect(response).toContain('volume:')
      expect(response).toContain('artists:')
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid commands', async () => {
      try {
        await client.sendCommand('invalidcommand')
        fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).toContain('unknown command "invalidcommand"')
      }
    })

    it('should handle invalid arguments', async () => {
      try {
        await client.sendCommand('play invalid')
        fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).toContain('Integer expected')
      }
    })
  })

  describe('Connection Management', () => {
    it('should maintain connection and handle idle events', (done) => {
      const timeoutId = setTimeout(() => {
        done()
      }, 1000)

      client.on('system', (subsystem) => {
        expect(typeof subsystem).toBe('string')
        clearTimeout(timeoutId)
        done()
      })

      // Trigger an event by changing volume
      client.sendCommand('setvol 50').catch(done)
    })

    it('should reconnect after disconnection', async () => {
      await client.disconnect()
      client = await MPDClient.connect({
        host: 'localhost',
        port: 6600
      })
      const response = await client.sendCommand('status')
      expect(response).toContain('volume:')
    })
  })
})
