import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

// ─── DATA ────────────────────────────────────────────────────────────────────
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
    northStar: { ...DEFAULT_NS },
    profile: { ...DEFAULT_PROFILE },
    showings: [],
  }
}

function newShowing() {
  return {
    id: Date.now().toString(),
    date: new Date().toISOString().split('T')[0],
    address: '', respondedTo: '', pulledBackFrom: '',
    moreTrue: '', lessTrue: '', hypothesisUpdate: '',
    agentName: '',
  }
}

function nsComplete(ns) {
  return [ns.propertyType, ns.location, ns.motivation, ns.whatMattersMost, ns.willingToTrade, ns.tradeFor].filter(Boolean).length
}

function daysSince(dateStr) {
  if (!dateStr) return null
  const diff = Math.floor((new Date() - new Date(dateStr)) / (1000 * 60 * 60 * 24))
  return diff
}

function formatPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 10)
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
}

const STATUSES = ['Active', 'Under Contract', 'Closed', 'On Hold']

const STATUS_COLORS = {
  'Active':         { bg: '#dcfce7', color: '#14532d', border: '#bbf7d0' },
  'Under Contract': { bg: '#dbeafe', color: '#1e3a5f', border: '#bfdbfe' },
  'Closed':         { bg: '#f3f4f6', color: '#374151', border: '#e5e7eb' },
  'On Hold':        { bg: '#fef9c3', color: '#713f12', border: '#fde68a' },
}

const MINDSET_ITEMS = [
  { title: 'Destroy Ambiguity', body: 'Everything starts unclear. Your job is to reduce uncertainty until the picture becomes clear. Every conversation and showing should create clarity. If the picture is still fuzzy, keep digging.' },
  { title: 'Find the Best Answer', body: 'Buyers tell you what they think they want. Experts identify what actually matters. You are not hired to collect answers — you are hired to find the best one.' },
  { title: '01 — Build', body: 'After the first conversation, complete the North Star. Listen for friction, gain, non-negotiables, patterns.' },
  { title: '02 — Test', body: 'Every showing is research. Watch what they linger on, dismiss, get excited about, or hesitate on.' },
  { title: '03 — Refine', body: 'Expert agents don\'t defend their first hypothesis. They improve it. The goal is clarity, not confirmation.' },
]

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function Dashboard({ session }) {
  const [buyers, setBuyers] = useState([])
  const [agents, setAgents] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [view, setView] = useState('list') // 'list' | 'buyer' | 'showing'
  const [tab, setTab] = useState('northstar')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showingDraft, setShowingDraft] = useState(null)
  const [editingShowingId, setEditingShowingId] = useState(null)
  const [nsExpanded, setNsExpanded] = useState(false)
  const [mindsetOpen, setMindsetOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [postShowingPrompt, setPostShowingPrompt] = useState(false)
  const saveTimers = useRef({})
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

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
    const loaded = (bRows || []).map(dbToBuyer)
    setBuyers(loaded)
    setAgents(aRows || [])
    if (loaded.length && !isMobile) setSelectedId(loaded[0].id)
    setLoading(false)
  }

  const handleRT = (payload) => {
    if (payload.eventType === 'INSERT') setBuyers(p => p.find(b => b.id === payload.new.id) ? p : [dbToBuyer(payload.new), ...p])
    else if (payload.eventType === 'UPDATE') setBuyers(p => p.map(b => b.id === payload.new.id ? dbToBuyer(payload.new) : b))
    else if (payload.eventType === 'DELETE') setBuyers(p => p.filter(b => b.id !== payload.old.id))
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
      setNsExpanded(true)
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

  const saveShowing = useCallback((showing) => {
    setBuyers(p => p.map(b => {
      if (b.id !== selectedId) return b
      const exists = b.showings.find(s => s.id === showing.id)
      const showings = exists
        ? b.showings.map(s => s.id === showing.id ? showing : s)
        : [...b.showings, showing]
      const nb = { ...b, showings }
      debouncedSave(nb)
      return nb
    }))
    setShowingDraft(null)
    setEditingShowingId(null)
    setView('buyer')
    setTab('showings')
    if (!showing.hypothesisUpdate) setPostShowingPrompt(true)
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
    setBuyers(p => { const u = p.filter(b => b.id !== id); setSelectedId(u.length ? u[0].id : null); return u })
    setView('list')
  }

  const openShowing = (showing = null) => {
    if (showing) { setShowingDraft({ ...showing }); setEditingShowingId(showing.id) }
    else { 
      const agentName = agents.find(a => a.id === session.user.id)?.name || ''
      setShowingDraft({ ...newShowing(), agentName })
      setEditingShowingId(null)
    }
    setView('showing')
    setPostShowingPrompt(false)
  }

  const selected = buyers.find(b => b.id === selectedId)
  const currentAgent = agents.find(a => a.id === session.user.id)

  const attention = (b) => {
    const count = nsComplete(b.northStar)
    const lastShowing = [...b.showings].sort((a, c) => new Date(c.date) - new Date(a.date))[0]
    const days = lastShowing ? daysSince(lastShowing.date) : null
    if (count < 3) return { level: 'high', msg: 'North Star incomplete' }
    if (days !== null && days > 14) return { level: 'med', msg: `No showing in ${days}d` }
    if (count < 6) return { level: 'low', msg: 'Hypothesis not complete' }
    return null
  }

  const filtered = buyers
    .filter(b => {
      const q = search.toLowerCase()
      const matchSearch = !q || b.clientName.toLowerCase().includes(q) || b.agentName.toLowerCase().includes(q)
      const matchStatus = statusFilter === 'all' || b.status === statusFilter
      return matchSearch && matchStatus
    })
    .sort((a, b) => {
      const aAttn = attention(a)
      const bAttn = attention(b)
      const rank = { high: 0, med: 1, low: 2, none: 3 }
      const aRank = rank[aAttn?.level || 'none']
      const bRank = rank[bAttn?.level || 'none']
      if (aRank !== bRank) return aRank - bRank
      return (a.clientName || '').localeCompare(b.clientName || '')
    })

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif', color: '#6b7280' }}>
      Loading...
    </div>
  )

  // ── SHOWING FORM VIEW ──
  if (view === 'showing' && showingDraft) {
    return (
      <div style={s.screen}>
        <div style={s.topBar}>
          <button style={s.backBtn} onClick={() => { setView('buyer'); setShowingDraft(null) }}>← Back</button>
          <div style={s.topBarTitle}>{editingShowingId ? 'Edit Showing' : 'Log a Showing'}</div>
          <div style={{ width: 60 }} />
        </div>
        <div style={s.scrollArea}>
          <div style={s.showingForm}>
            {/* Coaching prompt at top */}
            <div style={s.coachCard}>
              <div style={s.coachTitle}>After every showing, ask yourself:</div>
              <div style={s.coachQuestion}>Did the picture get clearer or fuzzier?</div>
              <div style={s.coachSub}>Your answers below should sharpen the North Star, not just record what happened.</div>
            </div>

            <div style={s.fieldGroup}>
              <div style={s.twoCol}>
                <div>
                  <FL>Date</FL>
                  <input type="date" style={s.field} value={showingDraft.date} onChange={e => setShowingDraft(d => ({ ...d, date: e.target.value }))} />
                </div>
                <div>
                  <FL>Logged by</FL>
                  <input style={s.field} value={showingDraft.agentName} placeholder="Agent name" onChange={e => setShowingDraft(d => ({ ...d, agentName: e.target.value }))} />
                </div>
              </div>
              <div>
                <FL>Property Address</FL>
                <input style={s.field} value={showingDraft.address} placeholder="123 Main St" onChange={e => setShowingDraft(d => ({ ...d, address: e.target.value }))} />
              </div>
            </div>

            <div style={s.debriefSection}>
              <div style={s.debriefLabel}>WHAT WE OBSERVED</div>
              <div>
                <FL>What they responded to — lingered on, got excited about</FL>
                <textarea style={s.textarea} value={showingDraft.respondedTo} placeholder="Features, rooms, moments that created energy..." onChange={e => setShowingDraft(d => ({ ...d, respondedTo: e.target.value }))} />
              </div>
              <div>
                <FL>What they pulled back from — dismissed or hesitated on</FL>
                <textarea style={s.textarea} value={showingDraft.pulledBackFrom} placeholder="What they brushed past, questioned, or walked away from..." onChange={e => setShowingDraft(d => ({ ...d, pulledBackFrom: e.target.value }))} />
              </div>
            </div>

            <div style={s.debriefSection}>
              <div style={s.debriefLabel}>WHAT WE LEARNED</div>
              <div>
                <FL>What became more true about the hypothesis</FL>
                <textarea style={s.textarea} value={showingDraft.moreTrue} placeholder="Evidence that confirmed what we believed..." onChange={e => setShowingDraft(d => ({ ...d, moreTrue: e.target.value }))} />
              </div>
              <div>
                <FL>What became less true about the hypothesis</FL>
                <textarea style={s.textarea} value={showingDraft.lessTrue} placeholder="Evidence that challenged what we believed..." onChange={e => setShowingDraft(d => ({ ...d, lessTrue: e.target.value }))} />
              </div>
            </div>

            <div style={s.debriefSection}>
              <div style={s.debriefLabel}>HOW THE NORTH STAR CHANGES</div>
              <div style={s.nsUpdateHint}>This is the most important field. Don't skip it.</div>
              <textarea style={{ ...s.textarea, borderColor: '#86efac', minHeight: 100 }} value={showingDraft.hypothesisUpdate} placeholder="Based on this showing, our hypothesis now says..." onChange={e => setShowingDraft(d => ({ ...d, hypothesisUpdate: e.target.value }))} />
            </div>

            <button style={s.saveShowingBtn} onClick={() => saveShowing(showingDraft)}>Save Showing</button>
          </div>
        </div>
      </div>
    )
  }

  // ── BUYER VIEW ──
  if ((view === 'buyer' || !isMobile) && selected) {
    const count = nsComplete(selected.northStar)
    const lastShowing = [...selected.showings].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
    const days = lastShowing ? daysSince(lastShowing.date) : null
    const badge = STATUS_COLORS[selected.status] || STATUS_COLORS['Active']

    return (
      <div style={s.appShell}>
        {/* Desktop sidebar */}
        {!isMobile && <Sidebar buyers={filtered} selected={selected} agents={agents} currentAgent={currentAgent} search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onSelect={id => { setSelectedId(id); setTab('northstar'); setNsExpanded(false) }} onAdd={addBuyer} onSignOut={() => supabase.auth.signOut()} mindsetOpen={mindsetOpen} setMindsetOpen={setMindsetOpen} attention={attention} />}

        <div style={s.buyerScreen}>
          {/* Header */}
          {isMobile && (
            <div style={s.topBar}>
              <button style={s.backBtn} onClick={() => setView('list')}>← Buyers</button>
              <div style={{ width: 60 }} />
            </div>
          )}

          <div style={s.buyerHeader}>
            <div style={s.buyerHeaderLeft}>
              <div style={s.buyerName}>{selected.clientName || 'Unnamed Buyer'}</div>
              {selected.contacts?.[1]?.name && <div style={s.buyerSpouse}>& {selected.contacts[1].name}</div>}
              <div style={s.buyerMeta}>
                {selected.agentName || 'No agent'} ·{' '}
                <span style={{ ...s.statusPill, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>{selected.status}</span>
                {' · '}
                <span style={{ color: saving ? '#f59e0b' : '#16a34a' }}>{saving ? 'Saving…' : 'Saved'}</span>
              </div>
            </div>
            <div style={s.buyerHeaderRight}>
              <button style={s.logShowingBtn} onClick={() => openShowing()}>+ Log Showing</button>
              <select style={s.statusSelect} value={selected.status} onChange={e => updateBuyer({ status: e.target.value })}>
                {STATUSES.map(st => <option key={st}>{st}</option>)}
              </select>
              <button style={s.deleteBtn} onClick={() => deleteBuyer(selected.id)}>Delete</button>
            </div>
          </div>

          {/* Post-showing prompt */}
          {postShowingPrompt && (
            <div style={s.promptBanner}>
              <div style={s.promptText}>Showing saved. Did the North Star change?</div>
              <div style={s.promptActions}>
                <button style={s.promptYes} onClick={() => { setTab('northstar'); setNsExpanded(true); setPostShowingPrompt(false) }}>Yes — update it</button>
                <button style={s.promptNo} onClick={() => setPostShowingPrompt(false)}>Not this time</button>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div style={s.tabBar}>
            {[['northstar', 'North Star'], ['contacts', 'Contacts'], ['profile', 'Profile'], ['showings', `Showings (${selected.showings.length})`], ['refinements', 'Refinements']].map(([k, l]) => (
              <button key={k} style={{ ...s.tab, ...(tab === k ? s.tabActive : {}) }} onClick={() => { setTab(k); setPostShowingPrompt(false) }}>{l}</button>
            ))}
          </div>

          <div style={s.tabContent}>
            {tab === 'northstar' && <NorthStarTab buyer={selected} updateNS={updateNS} nsExpanded={nsExpanded} setNsExpanded={setNsExpanded} count={count} days={days} lastShowing={lastShowing} />}
            {tab === 'contacts' && <ContactsTab buyer={selected} updateBuyer={updateBuyer} />}
            {tab === 'profile' && <ProfileTab buyer={selected} updateProfile={updateProfile} />}
            {tab === 'showings' && <ShowingsTab buyer={selected} openShowing={openShowing} deleteShowing={deleteShowing} />}
            {tab === 'refinements' && <RefinementsTab buyer={selected} />}
          </div>
        </div>
      </div>
    )
  }

  // ── LIST VIEW (mobile default / desktop sidebar) ──
  return (
    <div style={s.screen}>
      {isMobile ? (
        <>
          <div style={s.listHeader}>
            <div style={s.listHeaderTop}>
              <div>
                <div style={s.listBrand}>BUILD THE HOUSE</div>
                <div style={s.listUser}>{currentAgent?.name || session.user.email}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={s.mindsetBtn} onClick={() => setMindsetOpen(o => !o)}>Mindset</button>
                <button style={s.addBuyerBtn} onClick={addBuyer}>+ Buyer</button>
              </div>
            </div>
            <input style={s.searchInput} placeholder="Search buyers..." value={search} onChange={e => setSearch(e.target.value)} />
            <div style={s.statusFilterRow}>
              {['all', ...STATUSES].map(st => (
                <button key={st} style={{ ...s.statusChip, ...(statusFilter === st ? s.statusChipActive : {}) }} onClick={() => setStatusFilter(st)}>
                  {st === 'all' ? 'All' : st === 'Under Contract' ? 'Contract' : st}
                </button>
              ))}
            </div>
          </div>

          {mindsetOpen && (
            <div style={s.mindsetDrawer}>
              {MINDSET_ITEMS.map(m => (
                <div key={m.title} style={s.mindsetItem}>
                  <div style={s.mindsetTitle}>{m.title}</div>
                  <div style={s.mindsetBody}>{m.body}</div>
                </div>
              ))}
              <button style={s.closeMindset} onClick={() => setMindsetOpen(false)}>Close</button>
            </div>
          )}

          <div style={s.mobileList}>
            {filtered.length === 0 && (
              <div style={s.emptyState}>
                <div style={s.emptyTitle}>No buyers yet</div>
                <div style={s.emptySub}>Add your first buyer to start building the picture.</div>
                <button style={s.logShowingBtn} onClick={addBuyer}>+ Add Buyer</button>
              </div>
            )}
            {filtered.map(b => <BuyerCard key={b.id} buyer={b} attention={attention(b)} onSelect={() => { setSelectedId(b.id); setView('buyer'); setTab('northstar') }} onLog={() => { setSelectedId(b.id); openShowing() }} />)}
          </div>

          <div style={s.bottomBar}>
            <button style={s.bottomBarBtn} onClick={() => setMindsetOpen(o => !o)}>
              <div style={s.bottomBarIcon}>◎</div>
              <div style={s.bottomBarLabel}>Mindset</div>
            </button>
            <button style={s.bottomBarBtnPrimary} onClick={addBuyer}>
              <div style={{ fontSize: 22, lineHeight: 1 }}>+</div>
              <div style={s.bottomBarLabel}>New Buyer</div>
            </button>
            <button style={s.bottomBarBtn} onClick={() => supabase.auth.signOut()}>
              <div style={s.bottomBarIcon}>→</div>
              <div style={s.bottomBarLabel}>Sign Out</div>
            </button>
          </div>
        </>
      ) : (
        <div style={s.appShell}>
          <Sidebar buyers={filtered} selected={null} agents={agents} currentAgent={currentAgent} search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onSelect={id => { setSelectedId(id); setTab('northstar'); setNsExpanded(false); setView('buyer') }} onAdd={addBuyer} onSignOut={() => supabase.auth.signOut()} mindsetOpen={mindsetOpen} setMindsetOpen={setMindsetOpen} attention={attention} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#16a34a', fontWeight: 'bold', fontFamily: 'Georgia, serif' }}>BUILD THE HOUSE</div>
            <div style={{ fontSize: 14, color: '#9ca3af', fontFamily: 'Georgia, serif' }}>Select a buyer or add one to get started.</div>
            <button style={s.logShowingBtn} onClick={addBuyer}>+ Add Buyer</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── SIDEBAR (desktop) ────────────────────────────────────────────────────────
function Sidebar({ buyers, selected, agents, currentAgent, search, setSearch, statusFilter, setStatusFilter, onSelect, onAdd, onSignOut, mindsetOpen, setMindsetOpen, attention }) {
  return (
    <div style={s.sidebar}>
      <div style={s.sidebarTop}>
        <div style={s.brand}>BUILD THE HOUSE</div>
        <div style={s.brandSub}>Buyer Framework</div>
        <div style={s.sidebarUser}>
          <span>{currentAgent?.name || 'Agent'}</span>
          <button style={s.signOutBtn} onClick={onSignOut}>Sign out</button>
        </div>
      </div>

      <button style={s.mindsetToggle} onClick={() => setMindsetOpen(o => !o)}>
        <span>MINDSET</span><span>{mindsetOpen ? '▲' : '▼'}</span>
      </button>
      {mindsetOpen && (
        <div style={s.mindsetPanel}>
          {MINDSET_ITEMS.map(m => (
            <div key={m.title} style={s.mindsetItem}>
              <div style={s.mindsetTitle}>{m.title}</div>
              <div style={s.mindsetBody}>{m.body}</div>
            </div>
          ))}
        </div>
      )}

      <div style={s.sidebarSearch}>
        <input style={s.searchInput} placeholder="Search buyers..." value={search} onChange={e => setSearch(e.target.value)} />
        <button style={s.sidebarAddBtn} onClick={onAdd}>+</button>
      </div>

      <div style={s.statusFilterRow}>
        {['all', ...STATUSES].map(st => (
          <button key={st} style={{ ...s.statusChip, ...(statusFilter === st ? s.statusChipActive : {}) }} onClick={() => setStatusFilter(st)}>
            {st === 'all' ? 'All' : st === 'Under Contract' ? 'Contract' : st}
          </button>
        ))}
      </div>

      <div style={s.buyerCount}>{buyers.length} buyer{buyers.length !== 1 ? 's' : ''}</div>

      <div style={s.sidebarList}>
        {buyers.length === 0 && <div style={s.sidebarEmpty}>No buyers match.</div>}
        {buyers.map(b => <BuyerCard key={b.id} buyer={b} attention={attention(b)} active={selected?.id === b.id} onSelect={() => onSelect(b.id)} sidebar />)}
      </div>
    </div>
  )
}

// ─── BUYER CARD ───────────────────────────────────────────────────────────────
function BuyerCard({ buyer, attention, active, onSelect, onLog, sidebar }) {
  const badge = STATUS_COLORS[buyer.status] || STATUS_COLORS['Active']
  const count = nsComplete(buyer.northStar)
  const lastShowing = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
  const days = lastShowing ? daysSince(lastShowing.date) : null
  const attnColors = { high: '#fee2e2', med: '#fef9c3', low: '#f0fdf4' }
  const attnDot = { high: '#ef4444', med: '#f59e0b', low: '#86efac' }

  if (sidebar) {
    return (
      <div style={{ ...s.sidebarBuyerItem, ...(active ? s.sidebarBuyerActive : {}) }} onClick={onSelect}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={s.sidebarBuyerName}>{buyer.clientName || 'Unnamed Buyer'}</div>
          {attention && <div style={{ width: 7, height: 7, borderRadius: '50%', background: attnDot[attention.level], flexShrink: 0, marginTop: 3 }} />}
        </div>
        {buyer.contacts?.[1]?.name && <div style={s.sidebarBuyerSpouse}>& {buyer.contacts[1].name}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, alignItems: 'center' }}>
          <span style={s.sidebarBuyerAgent}>{buyer.agentName || 'No agent'}</span>
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>{buyer.status}</span>
        </div>
        {attention && <div style={{ fontSize: 10, color: attention.level === 'high' ? '#dc2626' : attention.level === 'med' ? '#d97706' : '#16a34a', marginTop: 3 }}>{attention.msg}</div>}
      </div>
    )
  }

  return (
    <div style={{ ...s.mobileCard, ...(attention ? { borderLeft: `4px solid ${attnDot[attention.level]}` } : {}) }} onClick={onSelect}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={s.mobileCardName}>{buyer.clientName || 'Unnamed Buyer'}</div>
          {buyer.contacts?.[1]?.name && <div style={s.mobileCardSpouse}>& {buyer.contacts[1].name}</div>}
          <div style={s.mobileCardMeta}>{buyer.agentName || 'No agent'}</div>
        </div>
        <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, whiteSpace: 'nowrap' }}>{buyer.status}</span>
      </div>
      <div style={s.mobileCardStats}>
        <span style={s.statPill}>North Star {count}/6</span>
        {days !== null && <span style={s.statPill}>{days === 0 ? 'Showing today' : `Last showing ${days}d ago`}</span>}
        {attention && <span style={{ ...s.statPill, background: attnColors[attention.level], color: attnDot[attention.level], border: `1px solid ${attnDot[attention.level]}` }}>{attention.msg}</span>}
      </div>
      {onLog && (
        <button style={s.quickLogBtn} onClick={e => { e.stopPropagation(); onLog() }}>+ Log Showing</button>
      )}
    </div>
  )
}

// ─── NORTH STAR TAB ───────────────────────────────────────────────────────────
function NorthStarTab({ buyer, updateNS, nsExpanded, setNsExpanded, count, days, lastShowing }) {
  const ns = buyer.northStar
  const pct = Math.round((count / 6) * 100)

  const coachMsg = () => {
    if (count === 0) return { msg: 'Start here. What did this buyer tell you in the first conversation?', level: 'prompt' }
    if (count < 3) return { msg: 'You\'ve started — keep going. Every empty field is an unanswered question.', level: 'prompt' }
    if (count < 6) return { msg: 'Getting clearer. Fill the remaining fields to complete the picture.', level: 'progress' }
    if (days !== null && days > 14) return { msg: `Hypothesis complete, but no showing in ${days} days. Is this still accurate?`, level: 'warning' }
    return { msg: 'Hypothesis complete. Update it after every showing.', level: 'complete' }
  }

  const coach = coachMsg()
  const coachBg = { prompt: '#eff6ff', progress: '#f0fdf4', warning: '#fef9c3', complete: '#f0fdf4' }
  const coachColor = { prompt: '#1d4ed8', progress: '#15803d', warning: '#b45309', complete: '#15803d' }

  return (
    <div style={s.pane}>
      {/* Coach card */}
      <div style={{ ...s.nsCoachCard, background: coachBg[coach.level] }}>
        <div style={{ fontSize: 12, color: coachColor[coach.level], lineHeight: 1.5 }}>{coach.msg}</div>
      </div>

      {/* Progress */}
      <div style={s.nsProgressRow}>
        <div style={s.nsProgressTrack}>
          <div style={{ ...s.nsProgressFill, width: `${pct}%` }} />
        </div>
        <span style={s.nsProgressLabel}>{count}/6 fields · {pct}% complete</span>
      </div>

      {/* Buckets */}
      <div style={s.nsBuckets}>
        <NsBucket title="THE BUYER" sub="What + where" fields={[
          { key: 'propertyType', label: 'Property Type', placeholder: 'e.g. single family home' },
          { key: 'location', label: 'Location', placeholder: 'e.g. Green Hills' },
        ]} ns={ns} updateNS={updateNS} />
        <NsBucket title="THE WHY" sub="Motivation + priority" fields={[
          { key: 'motivation', label: 'Core Motivation', placeholder: 'e.g. upsize for growing family' },
          { key: 'whatMattersMost', label: 'What Matters Most', placeholder: 'e.g. school district' },
        ]} ns={ns} updateNS={updateNS} />
        <NsBucket title="THE TRADE" sub="Give up + gain" fields={[
          { key: 'willingToTrade', label: 'Will Give Up', placeholder: 'e.g. proximity to work' },
          { key: 'tradeFor', label: 'In Exchange For', placeholder: 'e.g. space and yard' },
        ]} ns={ns} updateNS={updateNS} />
      </div>

      {/* Last showing context */}
      {lastShowing?.hypothesisUpdate && (
        <div style={s.lastUpdateCard}>
          <div style={s.lastUpdateLabel}>Last update after showing</div>
          <div style={s.lastUpdateText}>{lastShowing.hypothesisUpdate}</div>
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
function ContactsTab({ buyer, updateBuyer }) {
  return (
    <div style={s.pane}>
      {buyer.contacts.map(contact => {
        const upd = (key, val) => updateBuyer({ contacts: buyer.contacts.map(c => c.id === contact.id ? { ...c, [key]: val } : c) })
        const setPrimary = () => updateBuyer({ contacts: buyer.contacts.map(c => ({ ...c, isPrimary: c.id === contact.id })), clientName: contact.name })
        return (
          <div key={contact.id} style={{ ...s.contactCard, ...(contact.isPrimary ? s.contactCardPrimary : {}) }}>
            <div style={s.contactCardTop}>
              <input style={s.roleInput} value={contact.role} onChange={e => upd('role', e.target.value)} />
              {contact.isPrimary ? <span style={s.primaryBadge}>Primary</span> : <button style={s.setPrimaryBtn} onClick={setPrimary}>Set as primary</button>}
            </div>
            <div style={s.contactGrid}>
              <div style={{ gridColumn: '1 / -1' }}>
                <FL>Full Name</FL>
                <input style={s.field} value={contact.name} placeholder="Full name" onChange={e => { upd('name', e.target.value); if (contact.isPrimary) updateBuyer({ clientName: e.target.value }) }} />
              </div>
              <div><FL>Phone</FL><input style={s.field} value={contact.phone} placeholder="(615) 000-0000" onChange={e => upd('phone', formatPhone(e.target.value))} /></div>
              <div><FL>Email</FL><input style={s.field} value={contact.email} placeholder="email@example.com" onChange={e => upd('email', e.target.value)} /></div>
            </div>
          </div>
        )
      })}
      <div style={{ marginTop: 12 }}>
        <FL>Assigned Agent</FL>
        <input style={s.field} value={buyer.agentName} placeholder="Agent name" onChange={e => updateBuyer({ agentName: e.target.value })} />
      </div>
    </div>
  )
}

// ─── PROFILE TAB ─────────────────────────────────────────────────────────────
function ProfileTab({ buyer, updateProfile }) {
  return (
    <div style={s.pane}>
      <div style={s.profileNote}>These four inputs build the foundation. They inform everything in the North Star.</div>
      {[
        { key: 'friction', label: 'The Friction — what are they moving away from?', placeholder: 'What\'s broken, painful, or unsustainable in their current situation?' },
        { key: 'gain', label: 'The Gain — what are they moving toward?', placeholder: 'What does success look like for them?' },
        { key: 'nonNegotiables', label: 'Non-Negotiables — what kills a house immediately?', placeholder: 'Hard limits, deal-breakers...' },
        { key: 'patterns', label: 'Patterns — what keeps coming up?', placeholder: 'Recurring themes, consistent reactions...' },
      ].map(f => (
        <div key={f.key} style={{ marginBottom: 16 }}>
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
          <button style={s.logShowingBtn} onClick={() => openShowing()}>+ Log First Showing</button>
        </div>
      ) : (
        <>
          <button style={{ ...s.logShowingBtn, marginBottom: 16 }} onClick={() => openShowing()}>+ Log Showing</button>
          {sorted.map((sh, idx) => (
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
              <div style={s.showingDebrief}>
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
  const withUpdates = [...buyer.showings].sort((a, b) => new Date(a.date) - new Date(b.date)).filter(s => s.hypothesisUpdate)

  return (
    <div style={s.pane}>
      <div style={s.refinementsIntro}>
        This is your team's collective intelligence on this buyer. Every entry below is the picture getting sharper.
      </div>

      {buyer.showings.length === 0 ? (
        <div style={s.emptyState}>
          <div style={s.emptySub}>Log showings to see the hypothesis evolve here.</div>
        </div>
      ) : (
        <div style={s.timeline}>
          <div style={s.timelineItem}>
            <div style={s.timelineDot} />
            <div>
              <div style={s.timelineLabel}>Starting hypothesis</div>
              <div style={s.timelineText}>{count > 0 ? `${ns.propertyType || '—'} in ${ns.location || '—'} · ${ns.motivation || '—'}` : <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Not yet built</span>}</div>
            </div>
          </div>
          {withUpdates.length === 0 ? (
            <div style={{ paddingLeft: 20, fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>No hypothesis updates yet. Add them when debriefing each showing.</div>
          ) : withUpdates.map((sh, i) => (
            <div key={sh.id} style={s.timelineItem}>
              <div style={s.timelineDot} />
              <div>
                <div style={s.timelineLabel}>Showing {i + 1}{sh.address ? ` · ${sh.address}` : ''}{sh.agentName ? ` · ${sh.agentName}` : ''}</div>
                <div style={s.timelineText}>{sh.hypothesisUpdate}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function FL({ children }) {
  return <div style={s.fieldLabel}>{children}</div>
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s = {
  screen: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#f9fafb', fontFamily: "Georgia, 'Times New Roman', serif", overflow: 'hidden' },
  appShell: { display: 'flex', height: '100vh', fontFamily: "Georgia, 'Times New Roman', serif", background: '#f9fafb', overflow: 'hidden' },

  // Top bar (mobile)
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e5e7eb', flexShrink: 0 },
  topBarTitle: { fontSize: 14, fontWeight: 'bold', color: '#111827' },
  backBtn: { fontSize: 13, color: '#16a34a', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif', padding: '4px 0' },

  // Sidebar (desktop)
  sidebar: { width: 240, minWidth: 240, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  sidebarTop: { padding: '16px 14px 12px', borderBottom: '1px solid #e5e7eb' },
  brand: { fontSize: 9, letterSpacing: '0.22em', color: '#16a34a', fontWeight: 'bold', marginBottom: 2 },
  brandSub: { fontSize: 10, color: '#9ca3af', marginBottom: 8 },
  sidebarUser: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#6b7280' },
  signOutBtn: { fontSize: 10, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  mindsetToggle: { display: 'flex', justifyContent: 'space-between', padding: '9px 14px', background: 'none', border: 'none', borderBottom: '1px solid #e5e7eb', cursor: 'pointer', width: '100%', fontFamily: 'Georgia, serif', fontSize: 9, letterSpacing: '0.16em', color: '#6b7280', fontWeight: 'bold' },
  mindsetPanel: { padding: '12px 14px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', overflowY: 'auto', maxHeight: 220 },
  mindsetItem: { marginBottom: 12 },
  mindsetTitle: { fontSize: 11, fontWeight: 'bold', color: '#111827', marginBottom: 3 },
  mindsetBody: { fontSize: 11, color: '#6b7280', lineHeight: 1.6 },
  sidebarSearch: { display: 'flex', gap: 6, padding: '10px 12px 6px', alignItems: 'center' },
  sidebarAddBtn: { width: 28, height: 28, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, fontSize: 20, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  sidebarList: { flex: 1, overflowY: 'auto' },
  sidebarEmpty: { fontSize: 12, color: '#9ca3af', padding: '12px 14px', fontStyle: 'italic' },
  buyerCount: { fontSize: 10, color: '#9ca3af', padding: '2px 14px 4px' },

  sidebarBuyerItem: { padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6' },
  sidebarBuyerActive: { background: '#f0fdf4', borderLeft: '3px solid #16a34a', paddingLeft: 11 },
  sidebarBuyerName: { fontSize: 13, fontWeight: 'bold', color: '#111827', marginBottom: 1 },
  sidebarBuyerSpouse: { fontSize: 11, color: '#6b7280', marginBottom: 1 },
  sidebarBuyerAgent: { fontSize: 10, color: '#9ca3af' },

  // List header (mobile)
  listHeader: { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '14px 16px 10px', flexShrink: 0 },
  listHeaderTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  listBrand: { fontSize: 9, letterSpacing: '0.22em', color: '#16a34a', fontWeight: 'bold', marginBottom: 2 },
  listUser: { fontSize: 11, color: '#6b7280' },
  mindsetBtn: { padding: '6px 12px', border: '1px solid #e5e7eb', borderRadius: 4, background: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif', color: '#6b7280' },
  addBuyerBtn: { padding: '6px 14px', border: 'none', borderRadius: 4, background: '#16a34a', color: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },

  searchInput: { width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14, fontFamily: 'Georgia, serif', color: '#111827', outline: 'none', background: '#f9fafb', marginBottom: 8 },
  statusFilterRow: { display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 0 2px' },
  statusChip: { padding: '4px 10px', fontSize: 11, borderRadius: 4, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', color: '#6b7280', fontFamily: 'Georgia, serif' },
  statusChipActive: { background: '#16a34a', color: '#fff', borderColor: '#16a34a' },

  mobileList: { flex: 1, overflowY: 'auto', padding: '12px 16px', paddingBottom: 80 },

  // Buyer cards (mobile)
  mobileCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 16px', marginBottom: 10, cursor: 'pointer' },
  mobileCardName: { fontSize: 16, fontWeight: 'bold', color: '#111827', marginBottom: 2 },
  mobileCardSpouse: { fontSize: 13, color: '#6b7280', marginBottom: 2 },
  mobileCardMeta: { fontSize: 12, color: '#9ca3af', marginBottom: 8 },
  mobileCardStats: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  statPill: { fontSize: 11, padding: '3px 8px', borderRadius: 4, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  quickLogBtn: { padding: '8px 14px', border: 'none', borderRadius: 6, background: '#f0fdf4', color: '#15803d', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold', border: '1px solid #86efac', width: '100%' },

  // Bottom bar (mobile)
  bottomBar: { position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', display: 'flex', padding: '8px 0 12px', zIndex: 100 },
  bottomBarBtn: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  bottomBarBtnPrimary: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif', color: '#16a34a' },
  bottomBarIcon: { fontSize: 18, color: '#6b7280' },
  bottomBarLabel: { fontSize: 10, color: '#6b7280' },

  // Mindset drawer (mobile)
  mindsetDrawer: { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '16px', overflowY: 'auto', maxHeight: '60vh' },
  closeMindset: { marginTop: 12, padding: '8px 20px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', color: '#6b7280' },

  // Buyer screen (main panel)
  buyerScreen: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  buyerHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '16px 20px 12px', borderBottom: '1px solid #e5e7eb', flexShrink: 0, background: '#fff' },
  buyerHeaderLeft: {},
  buyerName: { fontSize: 20, fontWeight: 'bold', color: '#111827', marginBottom: 2 },
  buyerSpouse: { fontSize: 14, color: '#6b7280', marginBottom: 4 },
  buyerMeta: { fontSize: 12, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  statusPill: { fontSize: 10, padding: '2px 7px', borderRadius: 4 },
  buyerHeaderRight: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 },
  logShowingBtn: { padding: '8px 16px', border: 'none', borderRadius: 6, background: '#16a34a', color: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  statusSelect: { padding: '6px 10px', borderRadius: 4, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, fontFamily: 'Georgia, serif', cursor: 'pointer' },
  deleteBtn: { padding: '6px 12px', borderRadius: 4, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Post-showing prompt
  promptBanner: { background: '#f0fdf4', borderBottom: '1px solid #86efac', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', gap: 10 },
  promptText: { fontSize: 14, color: '#15803d', fontWeight: 'bold' },
  promptActions: { display: 'flex', gap: 10 },
  promptYes: { padding: '6px 14px', border: 'none', borderRadius: 6, background: '#16a34a', color: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  promptNo: { padding: '6px 14px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', color: '#6b7280', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Tabs
  tabBar: { display: 'flex', borderBottom: '1px solid #e5e7eb', flexShrink: 0, background: '#fff', overflowX: 'auto' },
  tab: { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontSize: 13, cursor: 'pointer', color: '#9ca3af', fontFamily: 'Georgia, serif', marginBottom: -1, whiteSpace: 'nowrap' },
  tabActive: { color: '#111827', borderBottomColor: '#16a34a', fontWeight: 'bold' },
  tabContent: { flex: 1, overflowY: 'auto', padding: '20px' },
  pane: { maxWidth: 820 },

  // North Star
  nsCoachCard: { borderRadius: 6, padding: '12px 14px', marginBottom: 16 },
  nsProgressRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  nsProgressTrack: { flex: 1, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' },
  nsProgressFill: { height: '100%', background: '#16a34a', borderRadius: 3, transition: 'width 0.4s' },
  nsProgressLabel: { fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' },
  nsBuckets: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 },
  nsBucket: { border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' },
  nsBucketHead: { background: '#f0fdf4', borderBottom: '1px solid #dcfce7', padding: '10px 14px' },
  nsBucketTitle: { fontSize: 9, letterSpacing: '0.18em', color: '#15803d', fontWeight: 'bold' },
  nsBucketSub: { fontSize: 10, color: '#86efac', marginTop: 1, color: '#4ade80' },
  nsBucketBody: { padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 },
  lastUpdateCard: { background: '#f0fdf4', border: '1px solid #dcfce7', borderRadius: 6, padding: '12px 14px' },
  lastUpdateLabel: { fontSize: 10, letterSpacing: '0.1em', color: '#16a34a', fontWeight: 'bold', marginBottom: 4 },
  lastUpdateText: { fontSize: 13, color: '#166534', lineHeight: 1.5 },

  // Form fields
  fieldLabel: { fontSize: 11, letterSpacing: '0.06em', color: '#6b7280', textTransform: 'uppercase', marginBottom: 5 },
  field: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb', fontSize: 14, fontFamily: 'Georgia, serif', color: '#111827', outline: 'none' },
  fieldFilled: { background: '#f0fdf4', borderColor: '#86efac', color: '#166534' },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb', fontSize: 14, fontFamily: 'Georgia, serif', color: '#111827', outline: 'none', resize: 'vertical', minHeight: 90, lineHeight: 1.6 },

  // Contacts
  contactCard: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '16px', marginBottom: 12, background: '#fff' },
  contactCardPrimary: { borderColor: '#86efac', background: '#f0fdf4' },
  contactCardTop: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  roleInput: { fontSize: 11, fontWeight: 'bold', letterSpacing: '0.08em', color: '#6b7280', background: 'transparent', border: 'none', borderBottom: '1px dashed #d1d5db', outline: 'none', padding: '2px 4px', fontFamily: 'Georgia, serif', textTransform: 'uppercase', width: 160 },
  primaryBadge: { fontSize: 10, background: '#16a34a', color: '#fff', padding: '2px 8px', borderRadius: 10 },
  setPrimaryBtn: { fontSize: 10, background: 'none', border: '1px solid #d1d5db', borderRadius: 10, color: '#9ca3af', padding: '2px 8px', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  contactGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginBottom: 12 },

  // Profile
  profileNote: { fontSize: 13, color: '#6b7280', fontStyle: 'italic', marginBottom: 20, padding: '10px 14px', background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' },

  // Showings
  showingCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '16px', marginBottom: 12 },
  showingCardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  showingAddr: { fontSize: 15, fontWeight: 'bold', color: '#111827' },
  showingDate: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  nsUpdateBlock: { background: '#f0fdf4', border: '1px solid #dcfce7', borderRadius: 6, padding: '10px 12px', marginBottom: 10 },
  nsUpdateLabel: { fontSize: 10, letterSpacing: '0.1em', color: '#16a34a', fontWeight: 'bold', marginBottom: 4 },
  nsUpdateText: { fontSize: 13, color: '#166534', lineHeight: 1.5 },
  showingDebrief: { fontSize: 13, color: '#4b5563', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 4 },
  debriefKey: { fontWeight: 'bold', color: '#374151' },

  // Showing form
  scrollArea: { flex: 1, overflowY: 'auto' },
  showingForm: { padding: '20px', maxWidth: 700, margin: '0 auto' },
  coachCard: { background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '14px 16px', marginBottom: 24 },
  coachTitle: { fontSize: 11, letterSpacing: '0.1em', color: '#1d4ed8', fontWeight: 'bold', marginBottom: 4 },
  coachQuestion: { fontSize: 16, color: '#1e40af', fontWeight: 'bold', marginBottom: 4 },
  coachSub: { fontSize: 12, color: '#3b82f6', lineHeight: 1.5 },
  fieldGroup: { marginBottom: 20 },
  debriefSection: { margin: '20px 0', display: 'flex', flexDirection: 'column', gap: 14 },
  debriefLabel: { fontSize: 10, letterSpacing: '0.16em', color: '#6b7280', fontWeight: 'bold', marginBottom: 8 },
  nsUpdateHint: { fontSize: 12, color: '#16a34a', fontStyle: 'italic', marginBottom: 8 },
  saveShowingBtn: { width: '100%', padding: '14px', border: 'none', borderRadius: 8, background: '#16a34a', color: '#fff', fontSize: 16, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold', marginTop: 8 },

  // Refinements
  refinementsIntro: { fontSize: 13, color: '#6b7280', fontStyle: 'italic', marginBottom: 20, padding: '12px 14px', background: '#f0fdf4', borderRadius: 6, border: '1px solid #dcfce7', lineHeight: 1.6 },
  timeline: { borderLeft: '2px solid #e5e7eb', paddingLeft: 20, marginLeft: 6 },
  timelineItem: { position: 'relative', paddingBottom: 20, display: 'flex', gap: 14 },
  timelineDot: { width: 10, height: 10, borderRadius: '50%', background: '#16a34a', flexShrink: 0, marginTop: 3, marginLeft: -25 },
  timelineLabel: { fontSize: 11, color: '#9ca3af', marginBottom: 4 },
  timelineText: { fontSize: 14, color: '#111827', lineHeight: 1.6 },

  // Empty states
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#9ca3af', marginBottom: 20, lineHeight: 1.6 },

  // Buttons
  ghostBtn: { padding: '7px 12px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  dangerBtn: { padding: '7px 12px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
}
