import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const API_ENABLED = Boolean(API_BASE) || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
const LOCAL_ACCOUNT_KEY = 'pulse_local_account'

type OneSignalApi = {
  login: (externalId: string) => Promise<void>
  Notifications: { requestPermission: () => Promise<boolean> }
}
declare global {
  interface Window {
    OneSignalDeferred?: Array<(oneSignal: OneSignalApi) => void | Promise<void>>
    pulseOneSignalEnabled?: boolean
  }
}

type Message = { id: number; author: string; initials: string; time?: string; createdAt?: string; text: string; tone: string }
type AuthUser = { id: number; name: string; initials: string; tone: string; email?: string }
type DirectoryUser = { id: number; name: string; initials: string; tone: string; role?: string; online?: boolean }
type Server = { id: number; name: string; slug: string; ownerId: number; memberCount: number; joined: number }
const channels = ['lobby', 'product-lab', 'design-room', 'music-share']
const people = [
  { id: 1, name: 'Mina Park', role: 'Product designer', initials: 'MP', tone: 'coral', online: true },
  { id: 2, name: 'Theo Brooks', role: 'Community lead', initials: 'TB', tone: 'gold', online: true },
  { id: 3, name: 'Inez Romero', role: 'Developer', initials: 'IR', tone: 'green', online: false },
  { id: 4, name: 'Noah Chen', role: 'Product designer', initials: 'NC', tone: 'blue', online: true },
]
const starterMessages: Message[] = [
  { id: 1, author: 'Mina Park', initials: 'MP', time: '09:41', text: 'Good morning, team. The new onboarding flow is ready for a first look.', tone: 'coral' },
  { id: 2, author: 'Theo Brooks', initials: 'TB', time: '09:44', text: 'It feels much clearer already. I especially like the little progress pulse on step two.', tone: 'gold' },
  { id: 3, author: 'You', initials: 'YO', time: '09:47', text: 'Same here. I dropped a few notes in the product brief so we can keep the momentum going.', tone: 'blue' },
  { id: 4, author: 'Mina Park', initials: 'MP', time: '09:49', text: 'Perfect. Let’s make this the thread where we collect final polish ideas.', tone: 'coral' },
]

function App() {
  const [activeChannel, setActiveChannel] = useState('lobby')
  const [messages, setMessages] = useState(starterMessages)
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [notifications, setNotifications] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [connected, setConnected] = useState(false)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' })
  const [authError, setAuthError] = useState('')
  const [friendships, setFriendships] = useState<Array<{ id: number; requesterId: number; addresseeId: number; status: string }>>([])
  const [directory, setDirectory] = useState<DirectoryUser[]>(people)
  const [servers, setServers] = useState<Server[]>([])
  const [serverName, setServerName] = useState('')
  const [showServerModal, setShowServerModal] = useState(false)
  const filteredPeople = useMemo(() => directory.filter((person) => person.name.toLowerCase().includes(search.toLowerCase())), [directory, search])
  useEffect(() => {
    const token = localStorage.getItem('pulse_token')
    if (!token) return
    if (token === 'local-demo-token') {
      const saved = localStorage.getItem(LOCAL_ACCOUNT_KEY)
      if (saved) setAuthUser(JSON.parse(saved).user)
      return
    }
    fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.ok ? response.json() : Promise.reject()).then(({ user }) => setAuthUser(user)).catch(() => localStorage.removeItem('pulse_token'))
    if (window.pulseOneSignalEnabled) {
      window.OneSignalDeferred = window.OneSignalDeferred || []
      window.OneSignalDeferred.push((oneSignal) => { if (authUser) return oneSignal.login(String(authUser.id)) })
    }
  }, [authUser])
  useEffect(() => {
    if (!authUser) return
    const token = localStorage.getItem('pulse_token') ?? ''
    fetch(`${API_BASE}/api/friends`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((rows) => { if (Array.isArray(rows)) setFriendships(rows) }).catch(() => undefined)
    fetch(`${API_BASE}/api/servers`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((rows) => { if (Array.isArray(rows)) setServers(rows) }).catch(() => undefined)
  }, [authUser])
  useEffect(() => {
    if (!authUser || search.trim().length < 2) { setDirectory(people); return }
    const token = localStorage.getItem('pulse_token') ?? ''
    fetch(`${API_BASE}/api/users/search?q=${encodeURIComponent(search)}`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((rows) => { if (Array.isArray(rows)) setDirectory(rows) }).catch(() => undefined)
  }, [authUser, search])
  useEffect(() => {
    const token = localStorage.getItem('pulse_token') ?? ''
    fetch(`${API_BASE}/api/channels/${activeChannel}/messages`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((serverMessages) => {
      if (Array.isArray(serverMessages)) setMessages(serverMessages)
    }).catch(() => undefined)
    const apiOrigin = API_BASE || window.location.origin
    const socketOrigin = apiOrigin.replace(/^http/, 'ws')
    const socket = new WebSocket(`${socketOrigin}/ws?channel=${activeChannel}`)
    socket.addEventListener('open', () => setConnected(true))
    socket.addEventListener('close', () => setConnected(false))
    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data)
      if (payload.type === 'message.created') setMessages((current) => current.some((message) => message.id === payload.message.id) ? current : [...current, payload.message])
    })
    return () => socket.close()
  }, [activeChannel])
  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    const token = localStorage.getItem('pulse_token') ?? ''
    await fetch(`${API_BASE}/api/channels/${activeChannel}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text }) }).catch(() => setMessages((current) => [...current, { id: Date.now(), author: authUser?.name ?? 'You', initials: authUser?.initials ?? 'YO', time: 'now', text, tone: authUser?.tone ?? 'blue' }]))
    setDraft('')
  }
  async function toggleNotifications() {
    if (notifications) {
      setNotifications(false)
      return
    }
    if (!window.pulseOneSignalEnabled) {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const permission = await Notification.requestPermission()
        if (permission === 'granted') await navigator.serviceWorker.register('/sw.js')
        setNotifications(permission === 'granted')
      }
      return
    }
    window.OneSignalDeferred = window.OneSignalDeferred || []
    window.OneSignalDeferred.push(async (oneSignal) => {
      const permissionGranted = await oneSignal.Notifications.requestPermission()
      setNotifications(permissionGranted)
    })
  }
  async function authenticate(event: FormEvent) {
    event.preventDefault()
    setAuthError('')
    if (!API_ENABLED) {
      const saved = localStorage.getItem(LOCAL_ACCOUNT_KEY)
      if (authMode === 'login' && (!saved || JSON.parse(saved).email !== authForm.email.toLowerCase() || JSON.parse(saved).password !== authForm.password)) { setAuthError('No local account matches. Choose Create account first.'); return }
      const localUser = authMode === 'register' ? { id: 9001, name: authForm.name.trim(), initials: authForm.name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(), tone: 'blue', email: authForm.email.toLowerCase() } : JSON.parse(saved as string).user
      if (authMode === 'register') localStorage.setItem(LOCAL_ACCOUNT_KEY, JSON.stringify({ email: authForm.email.toLowerCase(), password: authForm.password, user: localUser }))
      localStorage.setItem('pulse_token', 'local-demo-token')
      setAuthUser(localUser)
      return
    }
    const response = await fetch(`${API_BASE}/api/auth/${authMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(authForm) })
    const payload = await response.json()
    if (!response.ok) { setAuthError(payload.error ?? 'Authentication failed.'); return }
    localStorage.setItem('pulse_token', payload.token)
    setAuthUser(payload.user)
  }
  function signOut() {
    localStorage.removeItem('pulse_token')
    setAuthUser(null)
    setMessages(starterMessages)
  }
  async function updateFriend(personId: number) {
    const token = localStorage.getItem('pulse_token') ?? ''
    const relationship = friendships.find((friendship) => friendship.requesterId === personId || friendship.addresseeId === personId)
    if (!relationship) {
      const response = await fetch(`${API_BASE}/api/friends/${personId}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      if (response.ok) {
        const created = await response.json()
        setFriendships((current) => [...current, created])
      }
      return
    }
    if (relationship.status === 'pending' && relationship.addresseeId === authUser?.id) {
      const response = await fetch(`${API_BASE}/api/friends/${relationship.id}/accept`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } })
      if (response.ok) setFriendships((current) => current.map((item) => item.id === relationship.id ? { ...item, status: 'accepted' } : item))
    }
  }
  function friendLabel(personId: number) {
    const relationship = friendships.find((friendship) => friendship.requesterId === personId || friendship.addresseeId === personId)
    if (!relationship) return 'Add friend'
    if (relationship.status === 'accepted') return 'Friends'
    return relationship.addresseeId === authUser?.id ? 'Accept' : 'Pending'
  }
  async function createServer(event: FormEvent) {
    event.preventDefault()
    const token = localStorage.getItem('pulse_token') ?? ''
    const response = await fetch(`${API_BASE}/api/servers`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: serverName }) })
    if (response.ok) {
      const created = await response.json()
      setServers((current) => [created, ...current])
      setServerName('')
      setShowServerModal(false)
    }
  }
  async function joinServer(serverId: number) {
    const token = localStorage.getItem('pulse_token') ?? ''
    const response = await fetch(`${API_BASE}/api/servers/${serverId}/join`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    if (response.ok) setServers((current) => current.map((server) => server.id === serverId ? { ...server, joined: 1, memberCount: server.memberCount + 1 } : server))
  }

  if (!authUser) return <main className="auth-shell"><section className="auth-card"><div className="brand-mark">P</div><span className="eyebrow">Private conversations, made human</span><h1>{authMode === 'login' ? 'Welcome back.' : 'Make some room.'}</h1><p>{authMode === 'login' ? 'Sign in to pick up where your conversations left off.' : 'Create your Pulse account and find your people.'}</p>{!API_ENABLED && <p className="demo-notice">Preview mode: the live page needs an API URL for shared accounts. You can create a local preview account now.</p>}<form onSubmit={authenticate}>{authMode === 'register' && <label>Name<input required value={authForm.name} onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })} placeholder="Your name" /></label>}<label>Email<input required type="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} placeholder="you@example.com" /></label><label>Password<input required minLength={8} type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder="At least 8 characters" /></label>{authError && <p className="auth-error">{authError}</p>}<button className="primary-btn" type="submit">{authMode === 'login' ? 'Sign in' : 'Create account'}</button></form><button className="auth-switch" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError('') }}>{authMode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button></section></main>

  return (
    <main className="app-shell">
      <aside className="server-rail" aria-label="Servers"><div className="brand-mark">P</div><div className="rail-rule" />{servers.filter((server) => server.joined).map((server) => <button key={server.id} className="server active" aria-label={`${server.name}, ${server.memberCount} members`}>{server.name.slice(0, 2).toUpperCase()}</button>)}<button className="server add-server" aria-label="Create server" onClick={() => setShowServerModal(true)}>+</button><div className="rail-bottom"><button aria-label="Settings">⚙</button></div></aside>
      <aside className="sidebar"><div className="workspace-head"><div><span className="eyebrow">Your workspace</span><h1>Pulse club</h1></div><button className="icon-btn" aria-label="Workspace menu">•••</button></div><div className="sidebar-section"><div className="section-title">Channels <button aria-label="Add channel">+</button></div>{channels.map((channel) => <button key={channel} className={`channel ${activeChannel === channel ? 'selected' : ''}`} onClick={() => setActiveChannel(channel)}><span className="hash">#</span>{channel}</button>)}</div><div className="sidebar-section"><div className="section-title">Servers <button aria-label="Create server" onClick={() => setShowServerModal(true)}>+</button></div>{servers.slice(0, 4).map((server) => <button className="dm-row" key={server.id}><span className="server-label">{server.name.slice(0, 1)}</span><span>{server.name}</span><small className="server-members">{server.memberCount}</small></button>)}</div><div className="sidebar-section dm-section"><div className="section-title">Direct messages <button aria-label="Add direct message">+</button></div>{people.slice(0, 3).map((person) => <button className="dm-row" key={person.name}><span className={`avatar tiny ${person.tone}`}>{person.initials}</span><span>{person.name}</span><i className={person.online ? 'online' : ''} /></button>)}</div><div className="profile-card"><span className="avatar blue">{authUser.initials}</span><div><strong>{authUser.name}</strong><small><span className="online-dot" /> Active now</small></div><button className="icon-btn" aria-label="Sign out" onClick={signOut}>↪</button></div></aside>
      <section className="chat-panel"><header className="chat-header"><div className="channel-heading"><span className="big-hash">#</span><div><h2>{activeChannel}</h2><p>Ideas, updates, and good energy.</p></div></div><div className="header-actions"><span className={`connection ${connected ? 'live' : ''}`}><i />{connected ? 'Live' : 'Reconnecting'}</span><label className="search-box"><span>⌕</span><input aria-label="Search people" placeholder="Search people" value={search} onChange={(event) => setSearch(event.target.value)} /></label><button className="icon-btn" aria-label="Notifications" onClick={toggleNotifications}>{notifications ? '◔' : '◌'}</button><button className="icon-btn" aria-label="Pinned messages">⌑</button><button className="profile-mini" aria-label="Open your profile">YO</button></div></header><div className="chat-content"><div className="welcome-block"><div className="welcome-icon">✦</div><h2>Welcome to #{activeChannel}</h2><p>This is the beginning of the {activeChannel} channel.</p></div><div className="message-list">{messages.map((message) => <article className="message" key={message.id}><span className={`avatar ${message.tone}`}>{message.initials}</span><div className="message-body"><div className="message-meta"><strong>{message.author}</strong><time>{message.time ?? new Date(message.createdAt ?? '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{message.text}</p></div></article>)}</div><form className="composer" onSubmit={sendMessage}><button type="button" aria-label="Attach a file">＋</button><input aria-label="Message channel" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message #${activeChannel}`} /><div className="composer-tools"><button type="button" aria-label="Add gift">◇</button><button type="button" aria-label="Add emoji">☺</button><button className="send-btn" type="submit" aria-label="Send message">↑</button></div></form><p className="composer-note">Fast, frictionless conversations. No character cap.</p></div></section>
      <aside className="members-panel"><div className="members-head"><h2>People <span>{filteredPeople.length}</span></h2><button className="invite-btn" onClick={() => setShowInvite(true)}>Invite</button></div><p className="member-caption">Search every Pulse account</p><div className="member-list">{filteredPeople.map((person) => <div className="member" key={person.name}><span className={`avatar ${person.tone}`}>{person.initials}<i className={person.online ? 'online-badge' : ''} /></span><span className="member-copy"><strong>{person.name}</strong><small>{person.role ?? 'Pulse member'}</small></span><span className="presence-label">{person.online ? 'online' : 'away'}</span><button className={`friend-btn ${friendLabel(person.id) === 'Friends' ? 'is-friend' : ''}`} onClick={() => updateFriend(person.id)} disabled={friendLabel(person.id) === 'Pending' || friendLabel(person.id) === 'Friends'}>{friendLabel(person.id)}</button></div>)}</div><p className="member-caption server-directory-title">Discover servers</p><div className="server-directory">{servers.filter((server) => !server.joined).slice(0, 3).map((server) => <button className="discover-server" key={server.id} onClick={() => joinServer(server.id)}><span className="server-label">{server.name.slice(0, 1)}</span><span><strong>{server.name}</strong><small>{server.memberCount} members</small></span><b>Join</b></button>)}</div><div className="phone-card"><div className="phone-icon">⌁</div><div><strong>Stay in the loop</strong><p>Push notifications are {notifications ? 'on' : 'off'} for this workspace.</p></div><button className={`toggle ${notifications ? 'on' : ''}`} onClick={toggleNotifications} aria-label="Toggle push notifications"><span /></button></div></aside>
      {showInvite && <div className="modal-backdrop" onClick={() => setShowInvite(false)}><div className="invite-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowInvite(false)} aria-label="Close invite dialog">×</button><div className="modal-icon">↗</div><h2>Invite to Pulse club</h2><p>Share this space with your favorite people.</p><div className="invite-link">pulse.club/invite/bright-ideas <button onClick={() => setShowInvite(false)}>Copy</button></div><button className="primary-btn" onClick={() => setShowInvite(false)}>Done</button></div></div>}
      {showServerModal && <div className="modal-backdrop" onClick={() => setShowServerModal(false)}><form className="invite-modal" onSubmit={createServer} onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setShowServerModal(false)} aria-label="Close server dialog">×</button><div className="modal-icon">✦</div><h2>Create a server</h2><p>Start a space for any community. Membership is not capped in the app.</p><label className="modal-field">Server name<input required maxLength={60} value={serverName} onChange={(event) => setServerName(event.target.value)} placeholder="e.g. Night Owls" /></label><button className="primary-btn" type="submit">Create server</button></form></div>}
    </main>
  )
}

export default App
