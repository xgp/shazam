import type { FastifyInstance } from 'fastify'
import type { PtyClientMessage, PtyServerMessage } from '../../shared/types.js'
import type { SessionManager } from '../agent/sessions.js'

export function registerPtyRoute(app: FastifyInstance, sessions: SessionManager): void {
  app.get<{ Querystring: { id?: string } }>(
    '/ws/pty',
    { websocket: true },
    (socket, request) => {
      const id = request.query.id
      if (!id) {
        socket.close(1008, 'missing session id')
        return
      }

      const send = (message: PtyServerMessage) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
      }

      const detach = sessions.attach(id, send)
      /**
       * This client's own geometry. A phone and a desktop can watch the same
       * session, but a pty has one size: whoever is typing gets theirs, so the
       * other screen rewraps only while it is not the one in use.
       */
      let size: { cols: number; rows: number } | null = null

      socket.on('message', (raw: Buffer) => {
        let message: PtyClientMessage
        try {
          message = JSON.parse(raw.toString())
        } catch {
          return
        }

        if (message.type === 'input') {
          if (size) sessions.resize(id, size.cols, size.rows)
          sessions.write(id, message.data)
        } else if (message.type === 'resize') {
          size = { cols: message.cols, rows: message.rows }
          sessions.resize(id, message.cols, message.rows)
        }
      })

      // Detaching leaves the process running so the session survives a reload.
      socket.on('close', detach)
      socket.on('error', detach)
    },
  )
}
