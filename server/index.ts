import cors from 'cors'
import express from 'express'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import webpush from 'web-push'

const port = Number(process.env.PORT ?? 3001)
const app = express()
const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
const databasePath = join(process.cwd(), 'data', 'pulse.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })
const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, initials TEXT NOT NULL, tone TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, description TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(channel_id) REFERENCES channels(id), FOREIGN KEY(user_id) REFERENCES users(id));
  CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, endpoint TEXT UNIQUE NOT NULL, subscription_json TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id));
`)
const seed = db.prepare('INSERT OR IGNORE INTO users (id, name, initials, tone) VALUES (?, ?, ?, ?)')
seed.run(1, 'Mina Park', 'MP', 'coral'); seed.run(2, 'Theo Brooks', 'TB', 'gold'); seed.run(3, 'Inez Romero', 'IR', 'green'); seed.run(4, 'Noah Chen', 'NC', 'blue'); seed.run(5, 'You', 'YO', 'blue')
const channelSeed = db.prepare('INSERT OR IGNORE INTO channels (slug, description) VALUES (?, ?)')
for (const channel of ['lobby', 'product-lab', 'design-room', 'music-share']) channelSeed.run(channel, 'Ideas, updates, and good energy.')
const count = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }
if (count.count === 0) {
  const lobby = db.prepare('SELECT id FROM channels WHERE slug = ?').get('lobby') as { id: number }
  const insert = db.prepare('INSERT INTO messages (channel_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
  insert.run(lobby.id, 1, 'Good morning, team. The new onboarding flow is ready for a first look.', '2026-09-08T09:41:00.000Z')
  insert.run(lobby.id, 2, 'It feels much clearer already. I especially like the little progress pulse on step two.', '2026-09-08T09:44:00.000Z')
  insert.run(lobby.id, 5, 'Same here. I dropped a few notes in the product brief so we can keep the momentum going.', '2026-09-08T09:47:00.000Z')
  insert.run(lobby.id, 1, 'Perfect. Let’s make this the thread where we collect final polish ideas.', '2026-09-08T09:49:00.000Z')
}

app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use(express.static(join(process.cwd(), 'dist')))

function currentUser(request: express.Request) {
  const token = request.header('authorization')?.replace('Bearer ', '')
  if (!token) return null
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(token)) as { id: number; name: string; initials: string; tone: string } | null
}
function channelId(slug: string) {
  return (db.prepare('SELECT id FROM channels WHERE slug = ?').get(slug) as { id: number } | undefined)?.id
}
function messageView(channel: string) {
  return db.prepare(`SELECT messages.id, users.name as author, users.initials, users.tone, messages.body as text, messages.created_at as createdAt FROM messages JOIN users ON users.id = messages.user_id JOIN channels ON channels.id = messages.channel_id WHERE channels.slug = ? ORDER BY messages.id`).all(channel)
}

app.post('/api/auth/demo', (_request, response) => response.json({ token: '5', user: db.prepare('SELECT id, name, initials, tone FROM users WHERE id = 5').get() }))
app.get('/api/health', (_request, response) => response.json({ ok: true, service: 'pulse-api', database: 'sqlite', websocket: true, push: Boolean(process.env.VAPID_PUBLIC_KEY) }))
app.get('/api/channels/:channel/messages', (request, response) => response.json(messageView(request.params.channel)))
app.get('/api/config/push', (_request, response) => response.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null }))
app.post('/api/channels/:channel/messages', (request, response) => {
  const user = currentUser(request)
  const id = channelId(request.params.channel)
  const text = typeof request.body?.text === 'string' ? request.body.text.trim() : ''
  if (!user || !id || !text) return response.status(400).json({ error: 'Authenticated user, channel, and message text are required.' })
  const createdAt = new Date().toISOString()
  const result = db.prepare('INSERT INTO messages (channel_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').run(id, user.id, text, createdAt)
  const message = { id: result.lastInsertRowid, author: user.name, initials: user.initials, tone: user.tone, text, createdAt }
  broadcast(request.params.channel, { type: 'message.created', channel: request.params.channel, message })
  notifyPhones(user.id, request.params.channel, text).catch((error) => console.error('push delivery failed', error))
  response.status(201).json(message)
})
app.post('/api/push/subscribe', (request, response) => {
  const user = currentUser(request)
  const subscription = request.body
  if (!user || !subscription?.endpoint) return response.status(400).json({ error: 'Valid authentication and push subscription required.' })
  db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, subscription_json) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET subscription_json = excluded.subscription_json, user_id = excluded.user_id').run(user.id, subscription.endpoint, JSON.stringify(subscription))
  response.status(201).json({ subscribed: true })
})

const sockets = new Map<WebSocket, string>()
function broadcast(channel: string, payload: unknown) {
  const message = JSON.stringify(payload)
  for (const [socket, socketChannel] of sockets) if (socket.readyState === WebSocket.OPEN && socketChannel === channel) socket.send(message)
}
wss.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  const channel = url.searchParams.get('channel') ?? 'lobby'
  sockets.set(socket, channel)
  socket.send(JSON.stringify({ type: 'connected', channel }))
  socket.on('close', () => sockets.delete(socket))
})

async function notifyPhones(senderId: number, channel: string, text: string) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) return
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
  const subscriptions = db.prepare('SELECT subscription_json FROM push_subscriptions WHERE user_id != ?').all(senderId) as { subscription_json: string }[]
  await Promise.allSettled(subscriptions.map(({ subscription_json }) => webpush.sendNotification(JSON.parse(subscription_json), JSON.stringify({ title: `#${channel}`, body: text }))))
}

httpServer.listen(port, () => console.log(`Pulse API listening on http://localhost:${port}`))
