import cors from 'cors'
import express from 'express'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import webpush from 'web-push'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'

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
  CREATE TABLE IF NOT EXISTS friendships (id INTEGER PRIMARY KEY AUTOINCREMENT, requester_id INTEGER NOT NULL, addressee_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, UNIQUE(requester_id, addressee_id), FOREIGN KEY(requester_id) REFERENCES users(id), FOREIGN KEY(addressee_id) REFERENCES users(id));
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id));
  CREATE TABLE IF NOT EXISTS servers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, owner_id INTEGER NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(owner_id) REFERENCES users(id));
  CREATE TABLE IF NOT EXISTS server_members (server_id INTEGER NOT NULL, user_id INTEGER NOT NULL, joined_at TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', PRIMARY KEY(server_id, user_id), FOREIGN KEY(server_id) REFERENCES servers(id), FOREIGN KEY(user_id) REFERENCES users(id));
`)
try { db.exec('ALTER TABLE users ADD COLUMN email TEXT') } catch { /* Existing databases already have this column. */ }
try { db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT') } catch { /* Existing databases already have this column. */ }
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL') } catch { /* Existing databases already have this index. */ }
const seed = db.prepare('INSERT OR IGNORE INTO users (id, name, initials, tone) VALUES (?, ?, ?, ?)')
seed.run(1, 'Mina Park', 'MP', 'coral'); seed.run(2, 'Theo Brooks', 'TB', 'gold'); seed.run(3, 'Inez Romero', 'IR', 'green'); seed.run(4, 'Noah Chen', 'NC', 'blue'); seed.run(5, 'You', 'YO', 'blue')
const channelSeed = db.prepare('INSERT OR IGNORE INTO channels (slug, description) VALUES (?, ?)')
for (const channel of ['lobby', 'product-lab', 'design-room', 'music-share']) channelSeed.run(channel, 'Ideas, updates, and good energy.')
db.prepare('INSERT OR IGNORE INTO servers (id, name, slug, owner_id, created_at) VALUES (?, ?, ?, ?, ?)').run(1, 'Pulse club', 'pulse-club', 5, new Date().toISOString())
db.prepare('INSERT OR IGNORE INTO server_members (server_id, user_id, joined_at, role) SELECT 1, id, ?, CASE WHEN id = 5 THEN \'owner\' ELSE \'member\' END FROM users').run(new Date().toISOString())
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
  return db.prepare("SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ? AND sessions.expires_at > datetime('now')").get(token) as { id: number; name: string; initials: string; tone: string } | null
}
function issueSession(userId: number) {
  const token = randomBytes(32).toString('hex')
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))").run(token, userId)
  return token
}
function channelId(slug: string) {
  return (db.prepare('SELECT id FROM channels WHERE slug = ?').get(slug) as { id: number } | undefined)?.id
}
function messageView(channel: string) {
  return db.prepare(`SELECT messages.id, users.name as author, users.initials, users.tone, messages.body as text, messages.created_at as createdAt FROM messages JOIN users ON users.id = messages.user_id JOIN channels ON channels.id = messages.channel_id WHERE channels.slug = ? ORDER BY messages.id`).all(channel)
}

app.post('/api/auth/register', async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const name = typeof request.body?.name === 'string' ? request.body.name.trim().slice(0, 40) : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''
  if (!email || !name || password.length < 8) return response.status(400).json({ error: 'Name, valid email, and an 8-character password are required.' })
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return response.status(409).json({ error: 'An account with that email already exists.' })
  const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const result = db.prepare('INSERT INTO users (name, initials, tone, email, password_hash) VALUES (?, ?, ?, ?, ?)').run(name, initials || 'PU', 'blue', email, await bcrypt.hash(password, 12))
  const user = db.prepare('SELECT id, name, initials, tone, email FROM users WHERE id = ?').get(result.lastInsertRowid)
  response.status(201).json({ token: issueSession(Number(result.lastInsertRowid)), user })
})
app.post('/api/auth/login', async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as { id: number; password_hash?: string } | undefined
  if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) return response.status(401).json({ error: 'Email or password is incorrect.' })
  const profile = db.prepare('SELECT id, name, initials, tone, email FROM users WHERE id = ?').get(user.id)
  response.json({ token: issueSession(user.id), user: profile })
})
app.get('/api/auth/me', (request, response) => {
  const user = currentUser(request)
  if (!user) return response.status(401).json({ error: 'Authentication required.' })
  response.json({ user })
})
app.post('/api/auth/demo', (_request, response) => response.json({ token: issueSession(5), user: db.prepare('SELECT id, name, initials, tone FROM users WHERE id = 5').get() }))
app.get('/api/users/search', (request, response) => {
  const user = currentUser(request)
  const query = typeof request.query.q === 'string' ? request.query.q.trim() : ''
  if (!user) return response.status(401).json({ error: 'Authentication required.' })
  if (query.length < 2) return response.json([])
  response.json(db.prepare('SELECT id, name, initials, tone FROM users WHERE id != ? AND (lower(name) LIKE lower(?) OR lower(email) LIKE lower(?)) ORDER BY name LIMIT 50').all(user.id, `%${query}%`, `%${query}%`))
})
app.get('/api/servers', (request, response) => {
  const user = currentUser(request)
  if (!user) return response.status(401).json({ error: 'Authentication required.' })
  response.json(db.prepare('SELECT servers.id, servers.name, servers.slug, servers.owner_id as ownerId, (SELECT COUNT(*) FROM server_members WHERE server_id = servers.id) as memberCount, EXISTS(SELECT 1 FROM server_members WHERE server_id = servers.id AND user_id = ?) as joined FROM servers ORDER BY servers.id DESC').all(user.id))
})
app.post('/api/servers', (request, response) => {
  const user = currentUser(request)
  const name = typeof request.body?.name === 'string' ? request.body.name.trim().slice(0, 60) : ''
  if (!user || !name) return response.status(400).json({ error: 'A server name is required.' })
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server'}-${randomBytes(3).toString('hex')}`
  const result = db.prepare('INSERT INTO servers (name, slug, owner_id, created_at) VALUES (?, ?, ?, ?)').run(name, slug, user.id, new Date().toISOString())
  db.prepare("INSERT INTO server_members (server_id, user_id, joined_at, role) VALUES (?, ?, ?, 'owner')").run(result.lastInsertRowid, user.id, new Date().toISOString())
  response.status(201).json(db.prepare('SELECT id, name, slug, owner_id as ownerId, 1 as memberCount, 1 as joined FROM servers WHERE id = ?').get(result.lastInsertRowid))
})
app.post('/api/servers/:id/join', (request, response) => {
  const user = currentUser(request)
  const serverId = Number(request.params.id)
  if (!user || !db.prepare('SELECT id FROM servers WHERE id = ?').get(serverId)) return response.status(404).json({ error: 'Server not found.' })
  db.prepare("INSERT OR IGNORE INTO server_members (server_id, user_id, joined_at, role) VALUES (?, ?, ?, 'member')").run(serverId, user.id, new Date().toISOString())
  response.json({ joined: true })
})
app.get('/api/friends', (request, response) => {
  const user = currentUser(request)
  if (!user) return response.status(401).json({ error: 'Authentication required.' })
  const rows = db.prepare(`SELECT friendships.id, friendships.requester_id as requesterId, friendships.addressee_id as addresseeId, friendships.status, users.name, users.initials, users.tone FROM friendships JOIN users ON users.id = CASE WHEN friendships.requester_id = ? THEN friendships.addressee_id ELSE friendships.requester_id END WHERE friendships.requester_id = ? OR friendships.addressee_id = ? ORDER BY friendships.id DESC`).all(user.id, user.id, user.id)
  response.json(rows)
})
app.post('/api/friends/:userId', (request, response) => {
  const user = currentUser(request)
  const targetId = Number(request.params.userId)
  if (!user || !targetId || targetId === user.id || !db.prepare('SELECT id FROM users WHERE id = ?').get(targetId)) return response.status(400).json({ error: 'A valid friend target is required.' })
  const existing = db.prepare('SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)').get(user.id, targetId, targetId, user.id) as { id: number; status: string } | undefined
  if (existing) return response.json(existing)
  const result = db.prepare('INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, ?, ?)').run(user.id, targetId, 'pending', new Date().toISOString())
  response.status(201).json(db.prepare('SELECT * FROM friendships WHERE id = ?').get(result.lastInsertRowid))
})
app.patch('/api/friends/:id/accept', (request, response) => {
  const user = currentUser(request)
  const friendship = db.prepare('SELECT * FROM friendships WHERE id = ?').get(Number(request.params.id)) as { id: number; addressee_id: number; status: string } | undefined
  if (!user || !friendship || friendship.addressee_id !== user.id) return response.status(404).json({ error: 'Friend request not found.' })
  db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(friendship.id)
  response.json({ ...friendship, status: 'accepted' })
})
app.delete('/api/friends/:id', (request, response) => {
  const user = currentUser(request)
  const friendship = db.prepare('SELECT * FROM friendships WHERE id = ?').get(Number(request.params.id)) as { id: number; requester_id: number; addressee_id: number } | undefined
  if (!user || !friendship || ![friendship.requester_id, friendship.addressee_id].includes(user.id)) return response.status(404).json({ error: 'Friend relationship not found.' })
  db.prepare('DELETE FROM friendships WHERE id = ?').run(friendship.id)
  response.status(204).end()
})
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
