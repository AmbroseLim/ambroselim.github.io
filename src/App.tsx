import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

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
const channels = ['lobby', 'product-lab', 'design-room', 'music-share']
const people = [
  { name: 'Mina Park', role: 'Product designer', initials: 'MP', tone: 'coral', online: true },
  { name: 'Theo Brooks', role: 'Community lead', initials: 'TB', tone: 'gold', online: true },
  { name: 'Inez Romero', role: 'Developer', initials: 'IR', tone: 'green', online: false },
  { name: 'Noah Chen', role: 'Product designer', initials: 'NC', tone: 'blue', online: true },
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
  const filteredPeople = useMemo(() => people.filter((person) => person.name.toLowerCase().includes(search.toLowerCase())), [search])
  useEffect(() => {
    fetch('/api/auth/demo').then((response) => response.json()).then(({ token }) => localStorage.setItem('pulse_token', token)).catch(() => undefined)
    if (window.pulseOneSignalEnabled) {
      window.OneSignalDeferred = window.OneSignalDeferred || []
      window.OneSignalDeferred.push((oneSignal) => oneSignal.login('5'))
    }
  }, [])
  useEffect(() => {
    const token = localStorage.getItem('pulse_token') ?? '5'
    fetch(`/api/channels/${activeChannel}/messages`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((serverMessages) => {
      if (Array.isArray(serverMessages)) setMessages(serverMessages)
    }).catch(() => undefined)
    const socket = new WebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws?channel=${activeChannel}`)
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
    const token = localStorage.getItem('pulse_token') ?? '5'
    await fetch(`/api/channels/${activeChannel}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text }) }).catch(() => setMessages((current) => [...current, { id: Date.now(), author: 'You', initials: 'YO', time: 'now', text, tone: 'blue' }]))
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

  return (
    <main className="app-shell">
      <aside className="server-rail" aria-label="Workspaces"><div className="brand-mark">P</div><div className="rail-rule" /><button className="server active" aria-label="Pulse workspace">PL</button><button className="server server-pink" aria-label="Canvas workspace">C</button><button className="server server-yellow" aria-label="Arcade workspace">A</button><button className="server add-server" aria-label="Add workspace">+</button><div className="rail-bottom"><button aria-label="Settings">⚙</button></div></aside>
      <aside className="sidebar"><div className="workspace-head"><div><span className="eyebrow">Your workspace</span><h1>Pulse club</h1></div><button className="icon-btn" aria-label="Workspace menu">•••</button></div><div className="sidebar-section"><div className="section-title">Channels <button aria-label="Add channel">+</button></div>{channels.map((channel) => <button key={channel} className={`channel ${activeChannel === channel ? 'selected' : ''}`} onClick={() => setActiveChannel(channel)}><span className="hash">#</span>{channel}</button>)}</div><div className="sidebar-section dm-section"><div className="section-title">Direct messages <button aria-label="Add direct message">+</button></div>{people.slice(0, 3).map((person) => <button className="dm-row" key={person.name}><span className={`avatar tiny ${person.tone}`}>{person.initials}</span><span>{person.name}</span><i className={person.online ? 'online' : ''} /></button>)}</div><div className="profile-card"><span className="avatar blue">YO</span><div><strong>Your profile</strong><small><span className="online-dot" /> Active now</small></div><button className="icon-btn" aria-label="Profile settings">⚙</button></div></aside>
      <section className="chat-panel"><header className="chat-header"><div className="channel-heading"><span className="big-hash">#</span><div><h2>{activeChannel}</h2><p>Ideas, updates, and good energy.</p></div></div><div className="header-actions"><span className={`connection ${connected ? 'live' : ''}`}><i />{connected ? 'Live' : 'Reconnecting'}</span><label className="search-box"><span>⌕</span><input aria-label="Search people" placeholder="Search people" value={search} onChange={(event) => setSearch(event.target.value)} /></label><button className="icon-btn" aria-label="Notifications" onClick={toggleNotifications}>{notifications ? '◔' : '◌'}</button><button className="icon-btn" aria-label="Pinned messages">⌑</button><button className="profile-mini" aria-label="Open your profile">YO</button></div></header><div className="chat-content"><div className="welcome-block"><div className="welcome-icon">✦</div><h2>Welcome to #{activeChannel}</h2><p>This is the beginning of the {activeChannel} channel.</p></div><div className="message-list">{messages.map((message) => <article className="message" key={message.id}><span className={`avatar ${message.tone}`}>{message.initials}</span><div className="message-body"><div className="message-meta"><strong>{message.author}</strong><time>{message.time ?? new Date(message.createdAt ?? '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{message.text}</p></div></article>)}</div><form className="composer" onSubmit={sendMessage}><button type="button" aria-label="Attach a file">＋</button><input aria-label="Message channel" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message #${activeChannel}`} /><div className="composer-tools"><button type="button" aria-label="Add gift">◇</button><button type="button" aria-label="Add emoji">☺</button><button className="send-btn" type="submit" aria-label="Send message">↑</button></div></form><p className="composer-note">Fast, frictionless conversations. No character cap.</p></div></section>
      <aside className="members-panel"><div className="members-head"><h2>People <span>{filteredPeople.length}</span></h2><button className="invite-btn" onClick={() => setShowInvite(true)}>Invite</button></div><p className="member-caption">Everyone in Pulse club</p><div className="member-list">{filteredPeople.map((person) => <button className="member" key={person.name}><span className={`avatar ${person.tone}`}>{person.initials}<i className={person.online ? 'online-badge' : ''} /></span><span className="member-copy"><strong>{person.name}</strong><small>{person.role}</small></span><span className="presence-label">{person.online ? 'online' : 'away'}</span></button>)}</div><div className="phone-card"><div className="phone-icon">⌁</div><div><strong>Stay in the loop</strong><p>Push notifications are {notifications ? 'on' : 'off'} for this workspace.</p></div><button className={`toggle ${notifications ? 'on' : ''}`} onClick={toggleNotifications} aria-label="Toggle push notifications"><span /></button></div></aside>
      {showInvite && <div className="modal-backdrop" onClick={() => setShowInvite(false)}><div className="invite-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowInvite(false)} aria-label="Close invite dialog">×</button><div className="modal-icon">↗</div><h2>Invite to Pulse club</h2><p>Share this space with your favorite people.</p><div className="invite-link">pulse.club/invite/bright-ideas <button onClick={() => setShowInvite(false)}>Copy</button></div><button className="primary-btn" onClick={() => setShowInvite(false)}>Done</button></div></div>}
    </main>
  )
}

export default App
