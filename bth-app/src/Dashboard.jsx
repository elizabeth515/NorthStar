import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

// ─── DATA ─────────────────────────────────────────────────────────────────────
const DEFAULT_NS = { propertyType: '', location: '', motivation: '', whatMattersMost: '', willingToTrade: '', tradeFor: '' }
const DEFAULT_PROFILE = { friction: '', gain: '', nonNegotiables: '', patterns: '' }
const DEFAULT_CONTACTS = [
  { id: '1', name: '', phone: '', email: '', role: 'Buyer', isPrimary: true },
  { id: '2', name: '', phone: '', email: '', role: 'Spouse / Partner', isPrimary: false },
]

function dbToBuyer(row) {
  return {
    id: row.id,
    clientName: row.client_name || '',
    agentName: row.agent_name || '',
    status: row.status || 'Active',
    contacts: row.contacts?.length ? row.contacts : DEFAULT_CONTACTS.map(c => ({ ...c })),
    northStar: { ...DEFAULT_NS, ...(row.north_star || {}) },
    profile: { ...DEFAULT_PROFILE, ...(row.profile || {}) },
    showings: row.showings || [],
    createdAt: row.created_at,
  }
}

function buyerToDb(b) {
  return {
    client_name: b.clientName, agent_name: b.agentName, status: b.status,
    contacts: b.contacts, north_star: b.northStar,
    profile: b.profile, showings: b.showings,
    updated_at: new Date().toISOString(),
  }
}

function newBuyerObj(agentName = '') {
  return {
    clientName: '', agentName, status: 'Active',
    contacts: DEFAULT_CONTACTS.map(c => ({ ...c })),
    northStar: { ...DEFAULT_NS }, profile: { ...DEFAULT_PROFILE }, showings: [],
  }
}

function newShowing(agentName = '') {
  return {
    id: Date.now().toString(),
    date: new Date().toISOString().split('T')[0],
    address: '', agentName,
    respondedTo: '', pulledBackFrom: '',
    moreTrue: '', lessTrue: '', hypothesisUpdate: '',
  }
}

function nsComplete(ns) {
  return [ns.propertyType, ns.location, ns.motivation, ns.whatMattersMost, ns.willingToTrade, ns.tradeFor].filter(Boolean).length
}

function nsSummary(ns) {
  const parts = [
    ns.propertyType && ns.location ? `${ns.propertyType} in ${ns.location}` : ns.propertyType || ns.location,
    ns.motivation,
    ns.willingToTrade && ns.tradeFor ? `trades ${ns.willingToTrade} for ${ns.tradeFor}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

function formatPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 10)
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
}

const STATUSES = ['Active', 'Under Contract', 'Closed', 'On Hold']

const STATUS_COLORS = {
  'Active':         { bg: '#dcfce7', color: '#14532d', border: '#86efac' },
  'Under Contract': { bg: '#dbeafe', color: '#1e3a5f', border: '#93c5fd' },
  'Closed':         { bg: '#f3f4f6', color: '#374151', border: '#d1d5db' },
  'On Hold':        { bg: '#fef9c3', color: '#713f12', border: '#fde68a' },
}

// ─── COLORS ───────────────────────────────────────────────────────────────────
const C = {
  dark:      '#1c1917',   // warm charcoal — headers, buttons, structure
  darkHover: '#292524',   // slightly lighter for hover states
  gold:      '#b8962e',   // warm gold — accents, labels, filled fields
  goldLight: '#fdf6e3',   // very light gold tint for filled field backgrounds
  bg:        '#faf7f2',   // warm ivory — app background
  surface:   '#ffffff',   // card/panel surfaces
  border:    '#e8e2d9',   // warm border
  borderSoft:'#f0ebe3',   // very soft border
  text:      '#1c1917',   // primary text
  textMid:   '#57534e',   // secondary text
  textMuted: '#a8a29e',   // muted/placeholder text
  onDark:    '#ffffff',   // white text on dark surfaces
  onDarkMid: '#a8a29e',   // muted text on dark surfaces
  onDarkSub: '#78716c',   // very muted on dark
}

const MINDSET = [
  { title: 'Destroy Ambiguity', body: 'Everything starts unclear. Your job is to reduce uncertainty until the picture becomes clear. Every conversation and showing should create clarity. If the picture is still fuzzy, keep digging.' },
  { title: 'Find the Best Answer', body: 'Buyers tell you what they think they want. Experts identify what actually matters. You are hired to find the best answer — not collect them.' },
  { title: '01 — Build', body: 'After the first conversation, complete the North Star. Listen for friction, gain, non-negotiables, patterns.' },
  { title: '02 — Test', body: 'Every showing is research. Watch what they linger on, dismiss, get excited about, or hesitate on.' },
  { title: '03 — Refine', body: 'Expert agents don\'t defend their first hypothesis. They improve it. The goal is clarity, not confirmation.' },
]

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function Dashboard({ session }) {
  const [buyers, setBuyers] = useState([])
  const [agents, setAgents] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [view, setView] = useState('snapshot')
  const [tab, setTab] = useState('northstar')
  const [search, setSearch] = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showingDraft, setShowingDraft] = useState(null)
  const [editingShowingId, setEditingShowingId] = useState(null)
  const [aiNotification, setAiNotification] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [mindsetOpen, setMindsetOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const saveTimers = useRef({})

  useEffect(() => {
    loadData()
    const channel = supabase.channel('buyers-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'buyers' }, handleRT)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const loadData = async () => {
    setLoading(true)
    const [{ data: bRows }, { data: aRows }] = await Promise.all([
      supabase.from('buyers').select('*').order('created_at', { ascending: false }),
      supabase.from('agents').select('*').order('name'),
    ])
    setBuyers((bRows || []).map(dbToBuyer))
    setAgents(aRows || [])
    setLoading(false)
  }

  const handleRT = (p) => {
    if (p.eventType === 'INSERT') setBuyers(prev => prev.find(b => b.id === p.new.id) ? prev : [dbToBuyer(p.new), ...prev])
    else if (p.eventType === 'UPDATE') setBuyers(prev => prev.map(b => b.id === p.new.id ? dbToBuyer(p.new) : b))
    else if (p.eventType === 'DELETE') setBuyers(prev => prev.filter(b => b.id !== p.old.id))
  }

  const debouncedSave = useCallback((buyer) => {
    if (saveTimers.current[buyer.id]) clearTimeout(saveTimers.current[buyer.id])
    setSaving(true)
    saveTimers.current[buyer.id] = setTimeout(async () => {
      await supabase.from('buyers').update(buyerToDb(buyer)).eq('id', buyer.id)
      setSaving(false)
    }, 800)
  }, [])

  const addBuyer = async () => {
    const agentName = agents.find(a => a.id === session.user.id)?.name || ''
    const { data, error } = await supabase.from('buyers').insert(buyerToDb(newBuyerObj(agentName))).select().single()
    if (!error && data) {
      const b = dbToBuyer(data)
      setBuyers(p => [b, ...p])
      setSelectedId(b.id)
      setTab('northstar')
      setView('buyer')
    }
  }

  const updateBuyer = useCallback((patch) => {
    setBuyers(p => p.map(b => {
      if (b.id !== selectedId) return b
      const nb = { ...b, ...patch }
      debouncedSave(nb)
      return nb
    }))
  }, [selectedId, debouncedSave])

  const updateNS = useCallback((key, val) => {
    setBuyers(p => p.map(b => {
      if (b.id !== selectedId) return b
      const nb = { ...b, northStar: { ...b.northStar, [key]: val } }
      debouncedSave(nb)
      return nb
    }))
  }, [selectedId, debouncedSave])

  const updateProfile = useCallback((key, val) => {
    setBuyers(p => p.map(b => {
      if (b.id !== selectedId) return b
      const nb = { ...b, profile: { ...b.profile, [key]: val } }
      debouncedSave(nb)
      return nb
    }))
  }, [selectedId, debouncedSave])

  const saveShowing = useCallback(async (showing) => {
    let updatedBuyer = null
    setBuyers(p => p.map(b => {
      if (b.id !== selectedId) return b
      const exists = b.showings.find(s => s.id === showing.id)
      const showings = exists ? b.showings.map(s => s.id === showing.id ? showing : s) : [...b.showings, showing]
      const nb = { ...b, showings }
      debouncedSave(nb)
      updatedBuyer = nb
      return nb
    }))
    setShowingDraft(null)
    setEditingShowingId(null)
    setView('buyer')
    setTab('northstar')

    if (updatedBuyer && (showing.respondedTo || showing.pulledBackFrom || showing.moreTrue || showing.lessTrue || showing.hypothesisUpdate)) {
      setAiLoading(true)
      try {
        const res = await fetch('/api/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ northStar: updatedBuyer.northStar, showing }),
        })
        const data = await res.json()
        if (data.suggestions) {
          const prevNS = { ...updatedBuyer.northStar }
          const changed = Object.keys(data.suggestions).filter(k => data.suggestions[k] !== prevNS[k] && data.suggestions[k])
          if (changed.length > 0) {
            setBuyers(p => p.map(b => {
              if (b.id !== selectedId) return b
              const nb = { ...b, northStar: { ...b.northStar, ...data.suggestions } }
              debouncedSave(nb)
              return nb
            }))
            setAiNotification({ applied: data.suggestions, previous: prevNS, count: changed.length })
          }
        }
      } catch (_) {}
      setAiLoading(false)
    }
  }, [selectedId, debouncedSave])

  const undoAI = useCallback((prevNS) => {
    setBuyers(p => p.map(b => {
      if (b.id !== selectedId) return b
      const nb = { ...b, northStar: prevNS }
      debouncedSave(nb)
      return nb
    }))
    setAiNotification(null)
  }, [selectedId, debouncedSave])

  const deleteShowing = useCallback((sid) => {
    setBuyers(p => p.map(b => {
      if (b.id !== selectedId) return b
      const nb = { ...b, showings: b.showings.filter(s => s.id !== sid) }
      debouncedSave(nb)
      return nb
    }))
  }, [selectedId, debouncedSave])

  const deleteBuyer = async (id) => {
    if (!window.confirm('Delete this buyer?')) return
    await supabase.from('buyers').delete().eq('id', id)
    setBuyers(p => p.filter(b => b.id !== id))
    setView('snapshot')
    setSelectedId(null)
  }

  const openShowing = (showing = null) => {
    const agentName = agents.find(a => a.id === session.user.id)?.name || ''
    if (showing) { setShowingDraft({ ...showing }); setEditingShowingId(showing.id) }
    else { setShowingDraft(newShowing(agentName)); setEditingShowingId(null) }
    setView('showing')
    setAiNotification(null)
  }

  const selectBuyer = (id) => {
    setSelectedId(id)
    setTab('northstar')
    setView('buyer')
    setAiNotification(null)
  }

  const selected = buyers.find(b => b.id === selectedId)
  const currentAgent = agents.find(a => a.id === session.user.id)

  const filtered = buyers.filter(b => {
    const q = search.toLowerCase()
    const matchSearch = !q || b.clientName.toLowerCase().includes(q) || b.agentName.toLowerCase().includes(q)
    const matchAgent = agentFilter === 'all' || b.agentName === agentFilter
    const matchStatus = statusFilter === 'all' || b.status === statusFilter
    return matchSearch && matchAgent && matchStatus
  })

  if (loading) return <div style={s.loadingScreen}>Loading…</div>

  // ── SHOWING FORM ──
  if (view === 'showing' && showingDraft) {
    return <ShowingForm
      draft={showingDraft} setDraft={setShowingDraft}
      onSave={saveShowing}
      onCancel={() => { setView('buyer'); setShowingDraft(null) }}
      isEdit={!!editingShowingId}
    />
  }

  // ── BUYER DETAIL ──
  if (view === 'buyer' && selected) {
    return <BuyerView
      buyer={selected} agents={agents} currentAgent={currentAgent} saving={saving}
      tab={tab} setTab={setTab}
      aiNotification={aiNotification} aiLoading={aiLoading}
      setAiNotification={setAiNotification} undoAI={undoAI}
      updateBuyer={updateBuyer} updateNS={updateNS} updateProfile={updateProfile}
      saveShowing={saveShowing} deleteShowing={deleteShowing} deleteBuyer={deleteBuyer}
      openShowing={openShowing}
      onBack={() => setView('snapshot')}
    />
  }

  // ── SNAPSHOT ──
  return (
    <div style={s.screen}>
      <div style={s.topBar}>
        <div style={s.topBarLeft}>
          <div style={s.brand}>BUILD THE HOUSE</div>
          <div style={s.brandSub}>Buyer Framework</div>
        </div>
        <div style={s.topBarRight}>
          <span style={s.agentLabel}>{currentAgent?.name || session.user.email}</span>
          <button style={s.mindsetBtn} onClick={() => setMindsetOpen(o => !o)}>
            {mindsetOpen ? 'Close Mindset' : 'Mindset'}
          </button>
          <button style={s.addBuyerBtn} onClick={addBuyer}>+ New Buyer</button>
          <button style={s.signOutBtn} onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>

      {mindsetOpen && (
        <div style={s.mindsetBar}>
          {MINDSET.map(m => (
            <div key={m.title} style={s.mindsetItem}>
              <div style={s.mindsetTitle}>{m.title}</div>
              <div style={s.mindsetBody}>{m.body}</div>
            </div>
          ))}
        </div>
      )}

      <div style={s.filterBar}>
        <input style={s.searchInput} placeholder="Search buyers…" value={search} onChange={e => setSearch(e.target.value)} />
        <div style={s.filterDivider} />
        <span style={s.filterLabel}>AGENT</span>
        <select style={s.filterSelect} value={agentFilter} onChange={e => setAgentFilter(e.target.value)}>
          <option value="all">All Agents</option>
          {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
        <div style={s.filterDivider} />
        <span style={s.filterLabel}>STATUS</span>
        <div style={s.chips}>
          {['all', ...STATUSES].map(st => (
            <button key={st} style={{ ...s.chip, ...(statusFilter === st ? s.chipActive : {}) }} onClick={() => setStatusFilter(st)}>
              {st === 'all' ? 'All' : st === 'Under Contract' ? 'Contract' : st}
            </button>
          ))}
        </div>
        <span style={s.buyerCount}>{filtered.length} buyer{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div style={s.grid}>
        {filtered.length === 0 && (
          <div style={s.emptyGrid}>
            <div style={s.emptyTitle}>No buyers yet</div>
            <div style={s.emptySub}>Add your first buyer to start building the picture.</div>
            <button style={s.primaryBtn} onClick={addBuyer}>+ Add Buyer</button>
          </div>
        )}
        {filtered.map(b => (
          <SnapshotCard key={b.id} buyer={b}
            onOpen={() => selectBuyer(b.id)}
            onLog={() => { setSelectedId(b.id); openShowing() }}
          />
        ))}
      </div>
    </div>
  )
}

// ─── SNAPSHOT CARD ────────────────────────────────────────────────────────────
function SnapshotCard({ buyer, onOpen, onLog }) {
  const badge = STATUS_COLORS[buyer.status] || STATUS_COLORS['Active']
  const count = nsComplete(buyer.northStar)
  const summary = nsSummary(buyer.northStar)
  const lastShowing = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
  const needsAttention = count < 3

  return (
    <div style={{ ...s.card, ...(needsAttention ? s.cardAlert : {}) }}>
      <div style={s.cardTop}>
        <div>
          <div style={s.cardName}>{buyer.clientName || 'Unnamed Buyer'}</div>
          {buyer.contacts?.[1]?.name && <div style={s.cardSpouse}>& {buyer.contacts[1].name}</div>}
          <div style={s.cardAgent}>{buyer.agentName || 'No agent'}</div>
        </div>
        <span style={{ ...s.statusBadge, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>
          {buyer.status}
        </span>
      </div>

      <div style={s.cardBody}>
        <div style={s.cardNsLabel}>NORTH STAR</div>
        {summary
          ? <div style={s.cardNsSummary}>{summary}</div>
          : <div style={s.cardNsEmpty}>Hypothesis not started</div>
        }
        {lastShowing?.hypothesisUpdate && (
          <div style={s.cardLastUpdate}>
            <span style={s.cardLastUpdateLabel}>Last update: </span>
            {lastShowing.hypothesisUpdate}
          </div>
        )}
      </div>

      <div style={s.cardFooter}>
        <div style={s.cardMeta}>
          <span style={s.cardMetaText}>{buyer.showings.length} showing{buyer.showings.length !== 1 ? 's' : ''}</span>
          {needsAttention && <span style={s.cardAlertText}>{count === 0 ? '⚠ Start North Star' : `⚠ ${count}/6 fields`}</span>}
        </div>
        <div style={s.cardActions}>
          <button style={s.cardLogBtn} onClick={e => { e.stopPropagation(); onLog() }}>+ Log Showing</button>
          <button style={s.cardOpenBtn} onClick={onOpen}>{count === 0 ? 'Start →' : 'Open →'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── BUYER VIEW ───────────────────────────────────────────────────────────────
function BuyerView({ buyer, agents, currentAgent, saving, tab, setTab, aiNotification, aiLoading, setAiNotification, undoAI, updateBuyer, updateNS, updateProfile, saveShowing, deleteShowing, deleteBuyer, openShowing, onBack }) {
  const badge = STATUS_COLORS[buyer.status] || STATUS_COLORS['Active']

  return (
    <div style={s.buyerScreen}>
      <div style={s.buyerTopBar}>
        <button style={s.backBtn} onClick={onBack}>← All Buyers</button>
        <div style={s.buyerTopRight}>
          <button style={s.logShowingBtn} onClick={() => openShowing()}>+ Log Showing</button>
          <select style={s.statusSelectDark} value={buyer.status} onChange={e => updateBuyer({ status: e.target.value })}>
            {STATUSES.map(st => <option key={st}>{st}</option>)}
          </select>
          <button style={s.deleteBtnDark} onClick={() => deleteBuyer(buyer.id)}>Delete</button>
        </div>
      </div>

      <div style={s.buyerHeader}>
        <div>
          <div style={s.buyerName}>
            {buyer.clientName || 'Unnamed Buyer'}
            {buyer.contacts?.[1]?.name && <span style={s.buyerSpouse}> & {buyer.contacts[1].name}</span>}
          </div>
          <div style={s.buyerMeta}>
            {buyer.agentName || 'No agent'}
            <span style={s.metaDot}>·</span>
            <span style={{ ...s.statusPill, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>{buyer.status}</span>
            <span style={s.metaDot}>·</span>
            <span style={{ color: saving ? '#d97706' : C.gold }}>{saving ? 'Saving…' : 'Saved'}</span>
          </div>
        </div>
      </div>

      {aiLoading && (
        <div style={s.aiLoadBar}>
          <span style={s.aiLoadText}>✦ Analyzing showing — updating North Star…</span>
        </div>
      )}

      {aiNotification && (
        <div style={s.aiNotifBar}>
          <span style={s.aiNotifText}>✦ North Star updated — {aiNotification.count} field{aiNotification.count !== 1 ? 's' : ''} refined from showing</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={s.aiUndoBtn} onClick={() => undoAI(aiNotification.previous)}>Undo</button>
            <button style={s.aiDismissBtn} onClick={() => setAiNotification(null)}>✕</button>
          </div>
        </div>
      )}

      <div style={s.tabBar}>
        {[['northstar','North Star'],['contacts','Contacts'],['profile','Profile'],['showings',`Showings (${buyer.showings.length})`],['refinements','Refinements']].map(([k,l]) => (
          <button key={k} style={{ ...s.tab, ...(tab === k ? s.tabActive : {}) }} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div style={s.tabContent}>
        {tab === 'northstar'   && <NorthStarTab buyer={buyer} updateNS={updateNS} />}
        {tab === 'contacts'    && <ContactsTab buyer={buyer} updateBuyer={updateBuyer} agents={agents} />}
        {tab === 'profile'     && <ProfileTab buyer={buyer} updateProfile={updateProfile} />}
        {tab === 'showings'    && <ShowingsTab buyer={buyer} openShowing={openShowing} deleteShowing={deleteShowing} />}
        {tab === 'refinements' && <RefinementsTab buyer={buyer} />}
      </div>
    </div>
  )
}

// ─── NORTH STAR TAB ───────────────────────────────────────────────────────────
function NorthStarTab({ buyer, updateNS }) {
  const ns = buyer.northStar
  const count = nsComplete(ns)

  const coach = count === 0
    ? { msg: 'Start here. What did this buyer tell you in the first conversation?', bg: '#eff6ff', color: '#1d4ed8' }
    : count < 3
    ? { msg: 'You\'ve started — every empty field is an unanswered question. Keep going.', bg: '#fefce8', color: '#854d0e' }
    : count < 6
    ? { msg: 'Getting clearer. Fill the remaining fields to complete the picture.', bg: '#fefce8', color: '#854d0e' }
    : { msg: 'Hypothesis complete. Update it after every showing.', bg: '#f0fdf4', color: '#14532d' }

  const lastUpdate = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date)).find(s => s.hypothesisUpdate)

  return (
    <div style={s.pane}>
      <div style={{ ...s.coachCard, background: coach.bg }}>
        <span style={{ fontSize: 13, color: coach.color, lineHeight: 1.6 }}>{coach.msg}</span>
      </div>

      <div style={s.nsBuckets}>
        <NsBucket
          title="THE WHAT" sub="Property type + location"
          fields={[
            { key: 'propertyType', label: 'Property Type', placeholder: 'e.g. single family home' },
            { key: 'location', label: 'Location', placeholder: 'e.g. Green Hills' },
          ]}
          ns={ns} updateNS={updateNS}
        />
        <NsBucket
          title="THE WHY" sub="Motivation + what matters most"
          fields={[
            { key: 'motivation', label: 'Core Motivation', placeholder: 'e.g. upsize for growing family' },
            { key: 'whatMattersMost', label: 'What Matters Most', placeholder: 'e.g. school district' },
          ]}
          ns={ns} updateNS={updateNS}
        />
        <NsBucket
          title="THE TRADE" sub="What they'll give up + gain"
          fields={[
            { key: 'willingToTrade', label: 'Will Give Up', placeholder: 'e.g. proximity to work' },
            { key: 'tradeFor', label: 'In Exchange For', placeholder: 'e.g. space and yard' },
          ]}
          ns={ns} updateNS={updateNS}
        />
      </div>

      {lastUpdate && (
        <div style={s.lastUpdateCard}>
          <div style={s.lastUpdateLabel}>LAST UPDATE FROM SHOWING</div>
          <div style={s.lastUpdateText}>{lastUpdate.hypothesisUpdate}</div>
        </div>
      )}
    </div>
  )
}

function NsBucket({ title, sub, fields, ns, updateNS }) {
  return (
    <div style={s.nsBucket}>
      <div style={s.nsBucketHead}>
        <div style={s.nsBucketTitle}>{title}</div>
        <div style={s.nsBucketSub}>{sub}</div>
      </div>
      <div style={s.nsBucketBody}>
        {fields.map(f => (
          <div key={f.key}>
            <FL>{f.label}</FL>
            <input
              style={{ ...s.field, ...(ns[f.key] ? s.fieldFilled : {}) }}
              value={ns[f.key]}
              placeholder={f.placeholder}
              onChange={e => updateNS(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── CONTACTS TAB ─────────────────────────────────────────────────────────────
function ContactsTab({ buyer, updateBuyer, agents }) {
  return (
    <div style={s.pane}>
      {buyer.contacts.map(contact => {
        const upd = (key, val) => updateBuyer({ contacts: buyer.contacts.map(c => c.id === contact.id ? { ...c, [key]: val } : c) })
        const setPrimary = () => updateBuyer({ contacts: buyer.contacts.map(c => ({ ...c, isPrimary: c.id === contact.id })), clientName: contact.name })
        return (
          <div key={contact.id} style={{ ...s.contactCard, ...(contact.isPrimary ? s.contactCardPrimary : {}) }}>
            <div style={s.contactCardTop}>
              <input style={s.roleInput} value={contact.role} onChange={e => upd('role', e.target.value)} />
              {contact.isPrimary
                ? <span style={s.primaryBadge}>Primary</span>
                : <button style={s.setPrimaryBtn} onClick={setPrimary}>Set as primary</button>}
            </div>
            <div style={s.twoCol}>
              <div style={{ gridColumn: '1/-1' }}>
                <FL>Full Name</FL>
                <input style={s.field} value={contact.name} placeholder="Full name"
                  onChange={e => { upd('name', e.target.value); if (contact.isPrimary) updateBuyer({ clientName: e.target.value }) }} />
              </div>
              <div>
                <FL>Phone</FL>
                <input style={s.field} value={contact.phone} placeholder="(615) 000-0000" onChange={e => upd('phone', formatPhone(e.target.value))} />
              </div>
              <div>
                <FL>Email</FL>
                <input style={s.field} value={contact.email} placeholder="email@example.com" onChange={e => upd('email', e.target.value)} />
              </div>
            </div>
          </div>
        )
      })}
      <div style={{ marginTop: 8 }}>
        <FL>Assigned Agent</FL>
        <select style={s.field} value={buyer.agentName} onChange={e => updateBuyer({ agentName: e.target.value })}>
          <option value="">Select agent…</option>
          {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
      </div>
    </div>
  )
}

// ─── PROFILE TAB ─────────────────────────────────────────────────────────────
function ProfileTab({ buyer, updateProfile }) {
  return (
    <div style={s.pane}>
      <div style={s.profileNote}>These four inputs build the foundation. They feed directly into the North Star.</div>
      {[
        { key: 'friction', label: 'The Friction — what are they moving away from?', placeholder: 'What\'s broken or unsustainable in their current situation?' },
        { key: 'gain', label: 'The Gain — what are they moving toward?', placeholder: 'What does success look like for them?' },
        { key: 'nonNegotiables', label: 'Non-Negotiables — what kills a house immediately?', placeholder: 'Hard limits, deal-breakers…' },
        { key: 'patterns', label: 'Patterns — what keeps coming up?', placeholder: 'Recurring themes, consistent reactions…' },
      ].map(f => (
        <div key={f.key} style={{ marginBottom: 20 }}>
          <FL>{f.label}</FL>
          <textarea style={s.textarea} value={buyer.profile[f.key]} placeholder={f.placeholder} onChange={e => updateProfile(f.key, e.target.value)} />
        </div>
      ))}
    </div>
  )
}

// ─── SHOWINGS TAB ─────────────────────────────────────────────────────────────
function ShowingsTab({ buyer, openShowing, deleteShowing }) {
  const sorted = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date))
  return (
    <div style={s.pane}>
      {sorted.length === 0 ? (
        <div style={s.emptyState}>
          <div style={s.emptyTitle}>No showings yet</div>
          <div style={s.emptySub}>Log the first showing to start building the picture.</div>
          <button style={s.primaryBtn} onClick={() => openShowing()}>+ Log First Showing</button>
        </div>
      ) : (
        <>
          <button style={{ ...s.primaryBtn, marginBottom: 20 }} onClick={() => openShowing()}>+ Log Showing</button>
          {sorted.map(sh => (
            <div key={sh.id} style={s.showingCard}>
              <div style={s.showingCardTop}>
                <div>
                  <div style={s.showingAddr}>{sh.address || 'No address'}</div>
                  <div style={s.showingDate}>
                    {sh.date ? new Date(sh.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                    {sh.agentName ? ` · ${sh.agentName}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={s.ghostBtn} onClick={() => openShowing(sh)}>Edit</button>
                  <button style={s.dangerBtn} onClick={() => { if (window.confirm('Delete this showing?')) deleteShowing(sh.id) }}>Delete</button>
                </div>
              </div>
              {sh.hypothesisUpdate && (
                <div style={s.nsUpdateBlock}>
                  <div style={s.nsUpdateLabel}>North Star shift</div>
                  <div style={s.nsUpdateText}>{sh.hypothesisUpdate}</div>
                </div>
              )}
              <div style={s.debriefGrid}>
                {sh.respondedTo && <div><span style={s.debriefKey}>Responded to: </span>{sh.respondedTo}</div>}
                {sh.pulledBackFrom && <div><span style={s.debriefKey}>Pulled back from: </span>{sh.pulledBackFrom}</div>}
                {sh.moreTrue && <div><span style={s.debriefKey}>↑ More true: </span>{sh.moreTrue}</div>}
                {sh.lessTrue && <div><span style={s.debriefKey}>↓ Less true: </span>{sh.lessTrue}</div>}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ─── REFINEMENTS TAB ─────────────────────────────────────────────────────────
function RefinementsTab({ buyer }) {
  const ns = buyer.northStar
  const count = nsComplete(ns)
  const withUpdates = [...buyer.showings]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .filter(s => s.hypothesisUpdate)

  return (
    <div style={s.pane}>
      <div style={s.refinementsIntro}>
        This is your team's collective intelligence on this buyer. Every entry is the picture getting sharper.
      </div>
      {buyer.showings.length === 0 ? (
        <div style={s.emptySub}>Log showings to see the hypothesis evolve here.</div>
      ) : (
        <div style={s.timeline}>
          <div style={s.timelineItem}>
            <div style={s.timelineDot} />
            <div>
              <div style={s.timelineLabel}>Starting hypothesis</div>
              <div style={s.timelineText}>
                {count > 0
                  ? `${ns.propertyType || '—'} in ${ns.location || '—'} · ${ns.motivation || '—'}`
                  : <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Not yet built</span>}
              </div>
            </div>
          </div>
          {withUpdates.length === 0
            ? <div style={{ paddingLeft: 20, fontSize: 13, color: C.textMuted, fontStyle: 'italic' }}>No hypothesis updates yet.</div>
            : withUpdates.map((sh, i) => (
              <div key={sh.id} style={s.timelineItem}>
                <div style={s.timelineDot} />
                <div>
                  <div style={s.timelineLabel}>
                    Showing {i + 1}{sh.address ? ` · ${sh.address}` : ''}{sh.agentName ? ` · ${sh.agentName}` : ''}
                  </div>
                  <div style={s.timelineText}>{sh.hypothesisUpdate}</div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

// ─── SHOWING FORM ─────────────────────────────────────────────────────────────
function ShowingForm({ draft, setDraft, onSave, onCancel, isEdit }) {
  const upd = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  return (
    <div style={s.formScreen}>
      <div style={s.formTopBar}>
        <button style={s.backBtn} onClick={onCancel}>← Back</button>
        <div style={s.formTopTitle}>{isEdit ? 'Edit Showing' : 'Log a Showing'}</div>
        <div style={{ width: 80 }} />
      </div>
      <div style={s.formScroll}>
        <div style={s.formBody}>
          <div style={s.coachCard}>
            <div style={s.coachQ}>Did the picture get clearer or fuzzier?</div>
            <div style={s.coachSub}>Your answers should sharpen the North Star — not just record what happened. After you save, the AI will analyze your debrief and update the North Star automatically.</div>
          </div>

          <div style={s.twoCol}>
            <div><FL>Date</FL><input type="date" style={s.field} value={draft.date} onChange={e => upd('date', e.target.value)} /></div>
            <div><FL>Logged by</FL><input style={s.field} value={draft.agentName} placeholder="Agent name" onChange={e => upd('agentName', e.target.value)} /></div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <FL>Property Address</FL>
            <input style={s.field} value={draft.address} placeholder="123 Main St" onChange={e => upd('address', e.target.value)} />
          </div>

          <div style={s.formSection}>
            <div style={s.formSectionLabel}>WHAT WE OBSERVED</div>
            <div>
              <FL>What they responded to — lingered on, got excited about</FL>
              <textarea style={s.textarea} value={draft.respondedTo} placeholder="Features, rooms, moments that created energy…" onChange={e => upd('respondedTo', e.target.value)} />
            </div>
            <div>
              <FL>What they pulled back from — dismissed or hesitated on</FL>
              <textarea style={s.textarea} value={draft.pulledBackFrom} placeholder="What they brushed past, questioned, or rejected…" onChange={e => upd('pulledBackFrom', e.target.value)} />
            </div>
          </div>

          <div style={s.formSection}>
            <div style={s.formSectionLabel}>WHAT WE LEARNED</div>
            <div>
              <FL>What became more true about the hypothesis</FL>
              <textarea style={s.textarea} value={draft.moreTrue} placeholder="Evidence that confirmed what we believed…" onChange={e => upd('moreTrue', e.target.value)} />
            </div>
            <div>
              <FL>What became less true about the hypothesis</FL>
              <textarea style={s.textarea} value={draft.lessTrue} placeholder="Evidence that challenged what we believed…" onChange={e => upd('lessTrue', e.target.value)} />
            </div>
          </div>

          <div style={s.formSection}>
            <div style={s.formSectionLabel}>HOW THE NORTH STAR CHANGES</div>
            <div style={s.nsHint}>Most important field. Used by the AI to refine the hypothesis.</div>
            <textarea
              style={{ ...s.textarea, borderColor: C.gold, minHeight: 100 }}
              value={draft.hypothesisUpdate}
              placeholder="Based on this showing, our hypothesis now says…"
              onChange={e => upd('hypothesisUpdate', e.target.value)}
            />
          </div>

          <button style={s.saveShowingBtn} onClick={() => onSave(draft)}>Save Showing</button>
        </div>
      </div>
    </div>
  )
}

// ─── SHARED ───────────────────────────────────────────────────────────────────
function FL({ children }) {
  return <div style={s.fieldLabel}>{children}</div>
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s = {
  // Screens
  screen:      { display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: "Georgia, 'Times New Roman', serif", overflow: 'hidden', color: C.text },
  buyerScreen: { display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: "Georgia, 'Times New Roman', serif", overflow: 'hidden', color: C.text },
  formScreen:  { display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: "Georgia, 'Times New Roman', serif", overflow: 'hidden', color: C.text },
  loadingScreen: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Georgia, serif', color: C.textMuted, fontSize: 14 },

  // Top bar
  topBar:      { background: C.dark, padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
  topBarLeft:  {},
  brand:       { fontSize: 10, letterSpacing: '0.22em', color: C.gold, fontWeight: 'bold', marginBottom: 2 },
  brandSub:    { fontSize: 11, color: C.onDarkSub },
  topBarRight: { display: 'flex', alignItems: 'center', gap: 14 },
  agentLabel:  { fontSize: 12, color: C.onDarkMid },
  mindsetBtn:  { padding: '6px 12px', border: `1px solid #3c3835`, borderRadius: 4, background: 'transparent', color: C.onDarkMid, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  addBuyerBtn: { padding: '7px 16px', border: 'none', borderRadius: 4, background: C.gold, color: C.dark, fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  signOutBtn:  { fontSize: 11, color: C.onDarkSub, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Mindset bar
  mindsetBar:  { background: '#292524', borderBottom: `1px solid #3c3835`, padding: '14px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px 24px', flexShrink: 0 },
  mindsetItem: {},
  mindsetTitle:{ fontSize: 12, fontWeight: 'bold', color: C.gold, marginBottom: 4 },
  mindsetBody: { fontSize: 12, color: '#a8a29e', lineHeight: 1.6 },

  // Filter bar
  filterBar:    { background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0 },
  searchInput:  { padding: '7px 12px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.bg, fontSize: 13, fontFamily: 'Georgia, serif', color: C.text, outline: 'none', width: 180 },
  filterDivider:{ width: 1, height: 20, background: C.border },
  filterLabel:  { fontSize: 10, letterSpacing: '0.12em', color: C.textMuted, fontWeight: 'bold' },
  filterSelect: { padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.bg, fontSize: 12, fontFamily: 'Georgia, serif', color: C.text, cursor: 'pointer' },
  chips:        { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip:         { padding: '5px 11px', fontSize: 12, borderRadius: 4, border: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer', color: C.textMid, fontFamily: 'Georgia, serif' },
  chipActive:   { background: C.dark, color: C.gold, borderColor: C.dark, fontWeight: 'bold' },
  buyerCount:   { marginLeft: 'auto', fontSize: 12, color: C.textMuted },

  // Snapshot grid
  grid: { flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 16, alignContent: 'start' },

  // Cards
  card:          { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(28,25,23,0.06)' },
  cardAlert:     { borderColor: '#fca5a5' },
  cardTop:       { background: C.dark, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardName:      { fontSize: 15, color: C.onDark, fontWeight: 'bold', marginBottom: 2 },
  cardSpouse:    { fontSize: 12, color: C.onDarkSub, marginBottom: 2 },
  cardAgent:     { fontSize: 11, color: C.onDarkMid },
  statusBadge:   { fontSize: 10, padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap', marginTop: 2 },
  cardBody:      { padding: '14px 16px' },
  cardNsLabel:   { fontSize: 9, letterSpacing: '0.16em', color: C.gold, fontWeight: 'bold', marginBottom: 7 },
  cardNsSummary: { fontSize: 14, color: C.text, lineHeight: 1.6, marginBottom: 8 },
  cardNsEmpty:   { fontSize: 13, color: C.textMuted, fontStyle: 'italic', marginBottom: 8 },
  cardLastUpdate:      { fontSize: 12, color: C.textMid, background: C.bg, borderRadius: 4, padding: '6px 10px', lineHeight: 1.5, border: `1px solid ${C.borderSoft}` },
  cardLastUpdateLabel: { fontWeight: 'bold', color: C.gold },
  cardFooter:    { padding: '0 16px 14px' },
  cardMeta:      { display: 'flex', justifyContent: 'space-between', marginBottom: 10 },
  cardMetaText:  { fontSize: 11, color: C.textMuted },
  cardAlertText: { fontSize: 11, color: '#dc2626', fontWeight: 'bold' },
  cardActions:   { display: 'flex', gap: 8 },
  cardLogBtn:    { flex: 1, padding: '9px', background: C.dark, color: C.gold, border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  cardOpenBtn:   { padding: '9px 14px', background: C.bg, color: C.textMid, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Buyer top bar
  buyerTopBar:      { background: C.dark, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
  backBtn:          { fontSize: 12, color: C.gold, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  buyerTopRight:    { display: 'flex', gap: 8, alignItems: 'center' },
  logShowingBtn:    { padding: '7px 16px', border: 'none', borderRadius: 4, background: C.gold, color: C.dark, fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  statusSelectDark: { padding: '6px 10px', borderRadius: 4, border: '1px solid #3c3835', background: '#292524', fontSize: 12, fontFamily: 'Georgia, serif', cursor: 'pointer', color: C.onDarkMid },
  deleteBtnDark:    { padding: '6px 12px', borderRadius: 4, border: '1px solid #5a2020', background: 'transparent', color: '#f87171', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Buyer header
  buyerHeader:  { background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '16px 24px', flexShrink: 0 },
  buyerName:    { fontSize: 22, fontWeight: 'bold', color: C.text, marginBottom: 6 },
  buyerSpouse:  { fontSize: 16, color: C.textMid, fontWeight: 'normal' },
  buyerMeta:    { fontSize: 13, color: C.textMid, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaDot:      { color: C.border },
  statusPill:   { fontSize: 11, padding: '2px 8px', borderRadius: 4 },

  // AI bars
  aiLoadBar:    { background: '#292524', padding: '9px 24px', flexShrink: 0, borderBottom: '1px solid #3c3835' },
  aiLoadText:   { fontSize: 12, color: C.gold, fontStyle: 'italic' },
  aiNotifBar:   { background: C.goldLight, borderBottom: `1px solid #e6d4a0`, padding: '10px 24px', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  aiNotifText:  { fontSize: 13, color: '#78501a', fontWeight: 'bold' },
  aiUndoBtn:    { padding: '5px 12px', border: `1px solid #c9a84c`, borderRadius: 4, background: 'transparent', color: '#78501a', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  aiDismissBtn: { fontSize: 14, color: '#a8925a', background: 'none', border: 'none', cursor: 'pointer' },

  // Tabs
  tabBar:    { display: 'flex', borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.surface, overflowX: 'auto' },
  tab:       { padding: '11px 18px', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontSize: 13, cursor: 'pointer', color: C.textMuted, fontFamily: 'Georgia, serif', marginBottom: -1, whiteSpace: 'nowrap' },
  tabActive: { color: C.text, borderBottomColor: C.gold, fontWeight: 'bold' },
  tabContent:{ flex: 1, overflowY: 'auto', padding: '24px' },
  pane:      { maxWidth: 860 },

  // North Star
  coachCard:       { borderRadius: 6, padding: '12px 16px', marginBottom: 20 },
  coachQ:          { fontSize: 16, color: C.dark, fontWeight: 'bold', marginBottom: 4 },
  coachSub:        { fontSize: 13, color: C.textMid, lineHeight: 1.5 },
  nsBuckets:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 20 },
  nsBucket:        { border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: C.surface, boxShadow: '0 1px 3px rgba(28,25,23,0.04)' },
  nsBucketHead:    { background: C.dark, padding: '10px 14px' },
  nsBucketTitle:   { fontSize: 9, letterSpacing: '0.18em', color: C.gold, fontWeight: 'bold' },
  nsBucketSub:     { fontSize: 10, color: C.onDarkSub, marginTop: 2 },
  nsBucketBody:    { padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 },
  lastUpdateCard:  { background: C.goldLight, border: `1px solid #e6d4a0`, borderLeft: `3px solid ${C.gold}`, borderRadius: 6, padding: '12px 16px' },
  lastUpdateLabel: { fontSize: 9, letterSpacing: '0.14em', color: C.gold, fontWeight: 'bold', marginBottom: 6 },
  lastUpdateText:  { fontSize: 14, color: C.text, lineHeight: 1.6 },

  // Profile
  profileNote: { fontSize: 13, color: C.textMid, fontStyle: 'italic', marginBottom: 20, padding: '10px 14px', background: C.surface, borderRadius: 6, border: `1px solid ${C.border}` },

  // Contacts
  contactCard:        { border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px', marginBottom: 14, background: C.surface },
  contactCardPrimary: { borderColor: C.gold, background: C.goldLight },
  contactCardTop:     { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 },
  roleInput:          { fontSize: 11, fontWeight: 'bold', letterSpacing: '0.08em', color: C.textMid, background: 'transparent', border: 'none', borderBottom: `1px dashed ${C.border}`, outline: 'none', padding: '2px 4px', fontFamily: 'Georgia, serif', textTransform: 'uppercase', width: 160 },
  primaryBadge:       { fontSize: 10, background: C.dark, color: C.gold, padding: '2px 8px', borderRadius: 10 },
  setPrimaryBtn:      { fontSize: 10, background: 'none', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textMuted, padding: '2px 8px', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  twoCol:             { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' },

  // Form fields
  fieldLabel: { fontSize: 11, letterSpacing: '0.06em', color: C.textMuted, textTransform: 'uppercase', marginBottom: 5 },
  field:      { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 5, background: C.bg, fontSize: 14, fontFamily: 'Georgia, serif', color: C.text, outline: 'none' },
  fieldFilled:{ background: C.goldLight, borderColor: '#d4b060', color: C.dark },
  textarea:   { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 5, background: C.bg, fontSize: 14, fontFamily: 'Georgia, serif', color: C.text, outline: 'none', resize: 'vertical', minHeight: 90, lineHeight: 1.6 },

  // Showings
  showingCard:    { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px', marginBottom: 14 },
  showingCardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  showingAddr:    { fontSize: 15, fontWeight: 'bold', color: C.text },
  showingDate:    { fontSize: 12, color: C.textMuted, marginTop: 2 },
  nsUpdateBlock:  { background: C.goldLight, border: `1px solid #e6d4a0`, borderLeft: `3px solid ${C.gold}`, borderRadius: 4, padding: '10px 12px', marginBottom: 10 },
  nsUpdateLabel:  { fontSize: 9, letterSpacing: '0.12em', color: C.gold, fontWeight: 'bold', marginBottom: 4 },
  nsUpdateText:   { fontSize: 13, color: C.text, lineHeight: 1.5 },
  debriefGrid:    { fontSize: 13, color: C.textMid, lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 4 },
  debriefKey:     { fontWeight: 'bold', color: C.text },

  // Refinements
  refinementsIntro: { fontSize: 14, color: C.textMid, fontStyle: 'italic', marginBottom: 24, padding: '12px 16px', background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, lineHeight: 1.6 },
  timeline:         { borderLeft: `2px solid ${C.border}`, paddingLeft: 22, marginLeft: 6 },
  timelineItem:     { position: 'relative', paddingBottom: 22, display: 'flex', gap: 14 },
  timelineDot:      { width: 10, height: 10, borderRadius: '50%', background: C.gold, flexShrink: 0, marginTop: 3, marginLeft: -26 },
  timelineLabel:    { fontSize: 11, color: C.textMuted, marginBottom: 4 },
  timelineText:     { fontSize: 14, color: C.text, lineHeight: 1.6 },

  // Showing form
  formTopBar:      { background: C.dark, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
  formTopTitle:    { fontSize: 14, color: C.onDark, fontWeight: 'bold' },
  formScroll:      { flex: 1, overflowY: 'auto' },
  formBody:        { padding: '24px', maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 0 },
  formSection:     { marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 14 },
  formSectionLabel:{ fontSize: 10, letterSpacing: '0.16em', color: C.textMuted, fontWeight: 'bold', paddingBottom: 8, borderBottom: `1px solid ${C.border}`, marginBottom: 4 },
  nsHint:          { fontSize: 12, color: C.gold, fontStyle: 'italic', marginBottom: 8 },
  saveShowingBtn:  { width: '100%', padding: '14px', border: 'none', borderRadius: 8, background: C.dark, color: C.gold, fontSize: 16, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold', marginTop: 8 },

  // Buttons
  primaryBtn: { padding: '9px 20px', border: 'none', borderRadius: 5, background: C.dark, color: C.gold, fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  ghostBtn:   { padding: '7px 14px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface, color: C.textMid, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  dangerBtn:  { padding: '7px 14px', borderRadius: 5, border: '1px solid #fca5a5', background: C.surface, color: '#dc2626', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Empty states
  emptyGrid:  { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: C.text, marginBottom: 8 },
  emptySub:   { fontSize: 14, color: C.textMuted, marginBottom: 20, lineHeight: 1.6 },
}
