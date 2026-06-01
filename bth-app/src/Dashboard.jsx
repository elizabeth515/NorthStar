import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

// ─── DATA ─────────────────────────────────────────────────────────────────────
const DEFAULT_NS = { propertyType: '', location: '', motivation: '', outcome: '', veto: '', exchange: '', oneSentence: '' }
const DEFAULT_PROFILE = { friction: '', gain: '', nonNegotiables: '', patterns: '' }
const DEFAULT_CONTACTS = [
  { id: '1', name: '', phone: '', email: '', role: 'Buyer', isPrimary: true },
  { id: '2', name: '', phone: '', email: '', role: 'Spouse / Partner', isPrimary: false },
]

const MOVE_KEYS = ['motivation', 'outcome', 'veto', 'exchange']
const MOVE_LABELS = { motivation: 'M — Motivation', outcome: 'O — Outcome', veto: 'V — Veto', exchange: 'E — Exchange' }
const MOVE_QUESTIONS = {
  motivation: "What's driving this move?",
  outcome: "What does the right home give them?",
  veto: "What kills a house immediately?",
  exchange: "What will they trade to get what matters most?",
}

const DEBRIEF_FIELDS = [
  { key: 'respondedTo',    label: 'Responded to',    question: 'What created energy?' },
  { key: 'pulledBackFrom', label: 'Pulled back from', question: "What didn't land?" },
  { key: 'moreTrue',       label: 'More true',        question: 'What confirmed the MOVE?' },
  { key: 'lessTrue',       label: 'Less true',        question: 'What challenged the MOVE?' },
  { key: 'hypothesisUpdate', label: 'The shift',      question: 'How does the MOVE change?' },
]

const CONSULTATION_PREP = [
  "What's not working about where you are now?",
  "What does the right home change for you?",
  "What would make you walk away from a house?",
  "What matters most — the thing you won't compromise on?",
  "What would you give up to get that?",
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
    confidence: row.confidence || '',
    isMatch: row.is_match || false,
    createdAt: row.created_at,
  }
}

function buyerToDb(b) {
  return {
    client_name: b.clientName, agent_name: b.agentName, status: b.status,
    contacts: b.contacts, north_star: b.northStar,
    profile: b.profile, showings: b.showings,
    confidence: b.confidence || '',
    is_match: b.isMatch || false,
    updated_at: new Date().toISOString(),
  }
}

function newBuyerObj(agentName = '') {
  return {
    clientName: '', agentName, status: 'Active',
    contacts: DEFAULT_CONTACTS.map(c => ({ ...c })),
    northStar: { ...DEFAULT_NS }, profile: { ...DEFAULT_PROFILE },
    showings: [], confidence: '', isMatch: false,
  }
}

function newShowing(agentName = '') {
  return {
    id: Date.now().toString(),
    date: new Date().toISOString().split('T')[0],
    address: '', agentName, testingToday: '',
    respondedTo: '', pulledBackFrom: '',
    moreTrue: '', lessTrue: '', hypothesisUpdate: '',
  }
}

function nsComplete(ns) {
  return MOVE_KEYS.filter(k => ns[k]).length
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

const C = {
  dark: '#1c1917', darkHover: '#292524',
  gold: '#b8962e', goldLight: '#fdf6e3',
  bg: '#faf7f2', surface: '#ffffff',
  border: '#e8e2d9', borderSoft: '#f0ebe3',
  text: '#1c1917', textMid: '#57534e',
  textMuted: '#a8a29e',
  onDark: '#ffffff', onDarkMid: '#a8a29e', onDarkSub: '#78716c',
}

// ─── VOICE HOOK ───────────────────────────────────────────────────────────────
function useFreeVoice() {
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const recogRef = useRef(null)
  const silenceTimer = useRef(null)
  const latestRef = useRef('')

  const stop = useCallback(() => {
    if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null }
    if (recogRef.current) { try { recogRef.current.abort() } catch (_) {} recogRef.current = null }
    setListening(false)
  }, [])

  const start = useCallback((onDone) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Voice requires Chrome or Safari.'); return }
    setTranscript(''); latestRef.current = ''
    setListening(true)
    const r = new SR()
    r.continuous = true; r.interimResults = true; r.lang = 'en-US'
    recogRef.current = r
    let final = ''

    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim = t
      }
      const full = (final + interim).trim()
      latestRef.current = full
      setTranscript(full)
      if (silenceTimer.current) clearTimeout(silenceTimer.current)
      silenceTimer.current = setTimeout(() => {
        stop()
        onDone(latestRef.current)
      }, 5000)
    }

    r.onerror = (e) => { if (e.error !== 'aborted') { stop(); onDone(latestRef.current) } }
    r.onend = () => setListening(false)
    r.start()
  }, [stop])

  const stopAndReturn = useCallback((onDone) => {
    stop()
    onDone(latestRef.current)
  }, [stop])

  return { start, stop, stopAndReturn, listening, transcript }
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function Dashboard({ session }) {
  const [buyers, setBuyers] = useState([])
  const [agents, setAgents] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [view, setView] = useState('snapshot')
  const [tab, setTab] = useState('move')
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
      const { data } = await supabase.from('buyers').select('*').eq('id', buyer.id).single()
      if (data) setBuyers(p => p.map(b => b.id === data.id ? dbToBuyer(data) : b))
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
      setTab('move')
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

  const updateNS = useCallback((patch) => {
    setBuyers(p => p.map(b => {
      if (b.id !== selectedId) return b
      const nb = { ...b, northStar: { ...b.northStar, ...patch } }
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
    setTab('showings')

    // AI debrief
    const hasContent = showing.respondedTo || showing.pulledBackFrom || showing.moreTrue || showing.lessTrue || showing.hypothesisUpdate
    if (updatedBuyer && hasContent) {
      setAiLoading(true)
      try {
        const res = await fetch('/api/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'debrief', northStar: updatedBuyer.northStar, showing }),
        })
        const data = await res.json()
        if (data.result) {
          const { coachingQuestion, oneSentence, ...nsUpdates } = data.result
          const prevNS = { ...updatedBuyer.northStar }
          const changed = Object.keys(nsUpdates).filter(k => nsUpdates[k] && nsUpdates[k] !== prevNS[k])
          if (changed.length > 0 || oneSentence) {
            setBuyers(p => p.map(b => {
              if (b.id !== selectedId) return b
              const nb = { ...b, northStar: { ...b.northStar, ...nsUpdates, oneSentence: oneSentence || b.northStar.oneSentence } }
              debouncedSave(nb)
              return nb
            }))
            setAiNotification({ applied: nsUpdates, previous: prevNS, count: changed.length, coachingQuestion, oneSentence })
          } else if (coachingQuestion) {
            setAiNotification({ applied: {}, previous: prevNS, count: 0, coachingQuestion, oneSentence })
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
    setSelectedId(id); setTab('move'); setView('buyer'); setAiNotification(null)
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

  if (view === 'showing' && showingDraft) {
    return <ShowingForm draft={showingDraft} setDraft={setShowingDraft} onSave={saveShowing}
      onCancel={() => { setView('buyer'); setShowingDraft(null) }}
      isEdit={!!editingShowingId} buyer={selected} />
  }

  if (view === 'buyer' && selected) {
    return <BuyerView buyer={selected} agents={agents} currentAgent={currentAgent} saving={saving}
      tab={tab} setTab={setTab} aiNotification={aiNotification} aiLoading={aiLoading}
      setAiNotification={setAiNotification} undoAI={undoAI}
      updateBuyer={updateBuyer} updateNS={updateNS}
      saveShowing={saveShowing} deleteShowing={deleteShowing} deleteBuyer={deleteBuyer}
      openShowing={openShowing} onBack={() => setView('snapshot')} />
  }

  // ── SNAPSHOT ──
  return (
    <div style={s.screen}>
      <div style={s.topBar}>
        <div style={s.topBarLeft}>
          <div style={s.brand}>BUILD THE HOUSE</div>
          <div style={s.brandSub}>Powered by MOVE</div>
        </div>
        <div style={s.topBarRight}>
          <span style={s.agentLabel}>{currentAgent?.name || session.user.email}</span>
          <button style={s.mindsetBtn} onClick={() => setMindsetOpen(o => !o)}>{mindsetOpen ? 'Close' : 'Mindset'}</button>
          <button style={s.addBuyerBtn} onClick={addBuyer}>+ New Buyer</button>
          <button style={s.signOutBtn} onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>

      {mindsetOpen && (
        <div style={s.mindsetBar}>
          <div style={s.mindsetSection}>
            <div style={s.mindsetSectionTitle}>THE FRAME</div>
            <div style={s.mindsetText}>You are not searching for a house. You are diagnosing a buyer. The MOVE is the diagnosis. Showings are the tests. The match is the prescription.</div>
          </div>
          <div style={s.mindsetSection}>
            <div style={s.mindsetSectionTitle}>MOVE</div>
            {MOVE_KEYS.map(k => (
              <div key={k} style={s.mindsetMoveItem}>
                <span style={s.mindsetMoveLetter}>{k[0].toUpperCase()}</span>
                <span style={s.mindsetMoveText}>{MOVE_QUESTIONS[k]}</span>
              </div>
            ))}
          </div>
          <div style={s.mindsetSection}>
            <div style={s.mindsetSectionTitle}>BEFORE THE CONSULTATION</div>
            {CONSULTATION_PREP.map((q, i) => (
              <div key={i} style={s.mindsetPrepItem}><span style={s.mindsetPrepNum}>{i+1}</span><span style={s.mindsetText}>{q}</span></div>
            ))}
          </div>
          <div style={s.mindsetSection}>
            <div style={s.mindsetSectionTitle}>TWO ANCHORS</div>
            <div style={s.mindsetText}><strong style={{ color: C.gold }}>Destroy Ambiguity.</strong> Every conversation should create clarity. If the picture is still fuzzy, keep digging.</div>
            <div style={{ ...s.mindsetText, marginTop: 8 }}><strong style={{ color: C.gold }}>Find the Best Answer.</strong> You are not hired to collect answers. You are hired to find the best one.</div>
          </div>
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
            <div style={s.emptySub}>Add your first buyer to start building their MOVE.</div>
            <button style={s.primaryBtn} onClick={addBuyer}>+ Add Buyer</button>
          </div>
        )}
        {filtered.map(b => (
          <SnapshotCard key={b.id} buyer={b}
            onOpen={() => selectBuyer(b.id)}
            onLog={() => { setSelectedId(b.id); openShowing() }} />
        ))}
      </div>
    </div>
  )
}

// ─── SNAPSHOT CARD ────────────────────────────────────────────────────────────
function SnapshotCard({ buyer, onOpen, onLog }) {
  const badge = STATUS_COLORS[buyer.status] || STATUS_COLORS['Active']
  const count = nsComplete(buyer.northStar)
  const fuzzy = count < 2
  const lastShowing = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date))[0]

  return (
    <div style={{ ...s.card, ...(fuzzy && !buyer.isMatch ? s.cardFuzzy : {}), ...(buyer.isMatch ? s.cardMatch : {}) }}>
      <div style={s.cardTop}>
        <div style={s.cardTopLeft}>
          <div style={s.cardName}>{buyer.clientName || 'Unnamed Buyer'}</div>
          {buyer.contacts?.[1]?.name && <div style={s.cardSpouse}>& {buyer.contacts[1].name}</div>}
          <div style={s.cardAgent}>{buyer.agentName || 'No agent'}</div>
        </div>
        <span style={{ ...s.statusBadge, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>
          {buyer.status}
        </span>
      </div>

      <div style={s.cardBody}>
        {buyer.isMatch ? (
          <div style={s.cardMatchBadge}>✓ MOVE FOUND</div>
        ) : (
          <div style={s.cardConfidence}>
            {count === 0 ? <span style={s.cardFuzzyText}>MOVE not started</span>
              : count < 4 ? <span style={s.cardBuildingText}>MOVE building — {count}/4</span>
              : <span style={s.cardSharpText}>MOVE complete</span>}
          </div>
        )}

        {buyer.northStar.oneSentence ? (
          <div style={s.cardSentence}>{buyer.northStar.oneSentence}</div>
        ) : buyer.northStar.motivation ? (
          <div style={s.cardSentence}>{buyer.northStar.motivation}{buyer.northStar.outcome ? ` · ${buyer.northStar.outcome}` : ''}</div>
        ) : (
          <div style={s.cardSentenceEmpty}>No diagnosis yet. Start the MOVE.</div>
        )}

        {lastShowing?.hypothesisUpdate && (
          <div style={s.cardLastUpdate}>
            <span style={s.cardLastUpdateLabel}>Last shift: </span>
            {lastShowing.hypothesisUpdate}
          </div>
        )}
      </div>

      <div style={s.cardFooter}>
        <span style={s.cardStat}>{buyer.showings.length} showing{buyer.showings.length !== 1 ? 's' : ''}</span>
        <div style={s.cardActions}>
          {!buyer.isMatch && (
            <button style={s.cardLogBtn} onClick={e => { e.stopPropagation(); onLog() }}>+ Log Showing</button>
          )}
          <button style={s.cardOpenBtn} onClick={onOpen}>
            {count === 0 ? 'Start MOVE →' : buyer.isMatch ? 'View →' : 'Open →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── BUYER VIEW ───────────────────────────────────────────────────────────────
function BuyerView({ buyer, agents, currentAgent, saving, tab, setTab, aiNotification, aiLoading, setAiNotification, undoAI, updateBuyer, updateNS, saveShowing, deleteShowing, deleteBuyer, openShowing, onBack }) {
  const badge = STATUS_COLORS[buyer.status] || STATUS_COLORS['Active']
  return (
    <div style={s.buyerScreen}>
      <div style={s.buyerTopBar}>
        <button style={s.backBtn} onClick={onBack}>← All Buyers</button>
        <div style={s.buyerTopRight}>
          {!buyer.isMatch && <button style={s.logShowingBtn} onClick={() => openShowing()}>+ Log Showing</button>}
          {!buyer.isMatch
            ? <button style={s.markMatchBtn} onClick={() => updateBuyer({ isMatch: true, status: 'Under Contract' })}>✓ Found their MOVE</button>
            : <button style={s.unmatchBtn} onClick={() => updateBuyer({ isMatch: false })}>Unmark</button>}
          <select style={s.statusSelectDark} value={buyer.status} onChange={e => updateBuyer({ status: e.target.value })}>
            {STATUSES.map(st => <option key={st}>{st}</option>)}
          </select>
          <button style={s.deleteBtnDark} onClick={() => deleteBuyer(buyer.id)}>Delete</button>
        </div>
      </div>

      <div style={s.buyerHeader}>
        <div>
          <div style={s.buyerName}>{buyer.clientName || 'Unnamed Buyer'}{buyer.contacts?.[1]?.name && <span style={s.buyerSpouse}> & {buyer.contacts[1].name}</span>}</div>
          <div style={s.buyerMeta}>
            {buyer.agentName || 'No agent'}
            <span style={s.metaDot}>·</span>
            <span style={{ ...s.statusPill, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>{buyer.status}</span>
            <span style={s.metaDot}>·</span>
            <span style={{ color: saving ? '#d97706' : C.gold }}>{saving ? 'Saving…' : 'Saved'}</span>
          </div>
        </div>
        {buyer.northStar.oneSentence && (
          <div style={s.oneSentenceHeader}>{buyer.northStar.oneSentence}</div>
        )}
      </div>

      {aiLoading && <div style={s.aiLoadBar}><span style={s.aiLoadText}>✦ Analyzing showing — updating the MOVE…</span></div>}

      {aiNotification && (
        <AiPanel notification={aiNotification} onUndo={() => undoAI(aiNotification.previous)} onDismiss={() => setAiNotification(null)} />
      )}

      <div style={s.tabBar}>
        {[['move','The MOVE'],['contacts','Contacts'],['showings',`Showings (${buyer.showings.length})`],['refinements','Refinements']].map(([k,l]) => (
          <button key={k} style={{ ...s.tab, ...(tab === k ? s.tabActive : {}) }} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div style={s.tabContent}>
        {tab === 'move'        && <MoveTab buyer={buyer} updateNS={updateNS} updateBuyer={updateBuyer} agents={agents} />}
        {tab === 'contacts'    && <ContactsTab buyer={buyer} updateBuyer={updateBuyer} agents={agents} />}
        {tab === 'showings'    && <ShowingsTab buyer={buyer} openShowing={openShowing} deleteShowing={deleteShowing} />}
        {tab === 'refinements' && <RefinementsTab buyer={buyer} />}
      </div>
    </div>
  )
}

// ─── AI PANEL ─────────────────────────────────────────────────────────────────
function AiPanel({ notification, onUndo, onDismiss }) {
  const { applied, previous, count, coachingQuestion, oneSentence } = notification
  const changed = Object.keys(applied || {}).filter(k => applied[k] && applied[k] !== previous[k])

  return (
    <div style={s.aiPanel}>
      <div style={s.aiPanelTop}>
        <span style={s.aiPanelTitle}>✦ MOVE updated from showing</span>
        <div style={{ display: 'flex', gap: 10 }}>
          {count > 0 && <button style={s.aiUndoBtn} onClick={onUndo}>Undo</button>}
          <button style={s.aiDismissBtn} onClick={onDismiss}>✕</button>
        </div>
      </div>

      {oneSentence && (
        <div style={s.aiSentence}>{oneSentence}</div>
      )}

      {changed.length > 0 && (
        <div style={s.aiChanges}>
          {changed.map(k => (
            <div key={k} style={s.aiChange}>
              <span style={s.aiChangeField}>{MOVE_LABELS[k] || k}</span>
              <span style={s.aiChangePrev}>{previous[k] || <em style={{ color: C.textMuted }}>was empty</em>}</span>
              <span style={s.aiChangeArrow}>→</span>
              <span style={s.aiChangeNext}>{applied[k]}</span>
            </div>
          ))}
        </div>
      )}

      {coachingQuestion && (
        <div style={s.coachingQ}>
          <span style={s.coachingQLabel}>Next question to answer: </span>
          {coachingQuestion}
        </div>
      )}
    </div>
  )
}

// ─── MOVE TAB ─────────────────────────────────────────────────────────────────
function MoveTab({ buyer, updateNS, updateBuyer, agents }) {
  const ns = buyer.northStar
  const count = nsComplete(ns)
  const [intakeOpen, setIntakeOpen] = useState(count === 0)
  const { start, stopAndReturn, listening, transcript } = useFreeVoice()
  const [intakeListening, setIntakeListening] = useState(false)
  const [intakeTranscript, setIntakeTranscript] = useState('')
  const [intakeProcessing, setIntakeProcessing] = useState(false)

  const runIntake = () => {
    setIntakeListening(true)
    setIntakeTranscript('')
    start((text) => {
      setIntakeListening(false)
      setIntakeTranscript(text)
    })
  }

  const stopIntake = () => {
    stopAndReturn((text) => {
      setIntakeListening(false)
      setIntakeTranscript(text)
    })
  }

  const processIntake = async (text) => {
    if (!text.trim()) return
    setIntakeProcessing(true)
    try {
      const res = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'intake', transcript: text }),
      })
      const data = await res.json()
      if (data.extracted) {
        updateBuyer({ northStar: { ...ns, ...data.extracted } })
        if (buyer.clientName === '' && data.extracted.clientName) updateBuyer({ clientName: data.extracted.clientName })
        setIntakeOpen(false)
        setIntakeTranscript('')
      }
    } catch (_) {}
    setIntakeProcessing(false)
  }

  const coachMsg = count === 0 ? "Start the MOVE. Tell me about this buyer."
    : count < 2 ? "Keep going — every empty field is an unanswered question."
    : count < 4 ? "Getting clearer. Complete the diagnosis."
    : "MOVE complete. Update it after every showing."

  const confidenceNudge = {
    'fuzzy': "Can't see the MOVE yet — what's the one thing still unclear?",
    'getting-clearer': "MOVE is forming. Keep testing on the next showing.",
    'sharp': "Sharp diagnosis. Now prescribe the right home.",
  }

  return (
    <div style={s.pane}>

      {/* Intake panel */}
      {intakeOpen && (
        <div style={s.intakePanel}>
          <div style={s.intakePanelHeader}>
            <div style={s.intakePanelTitle}>THE MOVE INTERVIEW</div>
            <button style={s.intakePanelClose} onClick={() => setIntakeOpen(false)}>Dismiss</button>
          </div>
          <div style={s.intakePrepNote}>Before the consultation, listen for:</div>
          <div style={s.prepList}>
            {CONSULTATION_PREP.map((q, i) => (
              <div key={i} style={s.prepItem}>
                <span style={s.prepNum}>{i+1}</span>
                <span style={s.prepQ}>{q}</span>
              </div>
            ))}
          </div>
          <div style={s.intakeDivider}>After the consultation —</div>
          {!intakeTranscript ? (
            <>
              <div style={s.intakePrompt}>Tell me about this buyer.</div>
              <button style={intakeListening ? s.micBtnActive : s.micBtnReady}
                onClick={intakeListening ? stopIntake : runIntake}>
                {intakeListening ? '⏹ Done speaking' : '🎙 Tap and talk freely'}
              </button>
              {intakeListening && transcript && (
                <div style={s.intakeLiveText}>{transcript}</div>
              )}
              {intakeListening && <div style={s.intakeHint}>Pause 5 seconds to finish automatically.</div>}
            </>
          ) : (
            <>
              <div style={s.intakeReviewLabel}>What you said:</div>
              <div style={s.intakeReviewText}>{intakeTranscript}</div>
              <div style={s.intakeReviewActions}>
                {intakeProcessing
                  ? <div style={s.intakeProcessing}>✦ Building the MOVE…</div>
                  : <>
                    <button style={s.primaryBtn} onClick={() => processIntake(intakeTranscript)}>Build the MOVE →</button>
                    <button style={s.ghostBtn} onClick={() => { setIntakeTranscript(''); runIntake() }}>Re-record</button>
                  </>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Coach message */}
      <div style={s.moveCoachRow}>
        <div style={s.moveCoachMsg}>{coachMsg}</div>
        {!intakeOpen && (
          <button style={s.voiceIntakeBtn} onClick={() => setIntakeOpen(true)}>🎙 Voice Intake</button>
        )}
      </div>

      {/* One sentence MOVE */}
      {ns.oneSentence && (
        <div style={s.oneSentenceCard}>
          <div style={s.oneSentenceLabel}>THE DIAGNOSIS</div>
          <div style={s.oneSentenceText}>{ns.oneSentence}</div>
        </div>
      )}

      {/* MOVE fields */}
      <div style={s.moveWord}>MOVE</div>
      <div style={s.moveGrid}>
        {MOVE_KEYS.map(k => (
          <MoveField key={k} letter={k[0].toUpperCase()} label={MOVE_LABELS[k]} question={MOVE_QUESTIONS[k]}
            value={ns[k] || ''} onChange={v => updateNS({ [k]: v })} />
        ))}
      </div>

      {/* Location + property type */}
      <div style={s.moveLocationGrid}>
        <div>
          <FL>Property Type</FL>
          <input style={{ ...s.field, ...(ns.propertyType ? s.fieldFilled : {}) }}
            value={ns.propertyType || ''} placeholder="e.g. single family home"
            onChange={e => updateNS({ propertyType: e.target.value })} />
        </div>
        <div>
          <FL>Location</FL>
          <input style={{ ...s.field, ...(ns.location ? s.fieldFilled : {}) }}
            value={ns.location || ''} placeholder="e.g. Green Hills"
            onChange={e => updateNS({ location: e.target.value })} />
        </div>
      </div>

      {/* Confidence */}
      <div style={s.confidenceSection}>
        <div style={s.confidenceLabel}>How clearly do you see their MOVE?</div>
        <div style={s.confidenceOptions}>
          {[
            { val: 'fuzzy', icon: '◎', label: "Can't see the MOVE", sub: 'Still diagnosing' },
            { val: 'getting-clearer', icon: '◑', label: 'MOVE is forming', sub: 'Tests confirming' },
            { val: 'sharp', icon: '●', label: 'MOVE is clear', sub: 'Ready to prescribe' },
          ].map(opt => (
            <button key={opt.val}
              style={{ ...s.confidenceOption, ...(buyer.confidence === opt.val ? s.confidenceOptionActive : {}) }}
              onClick={() => updateBuyer({ confidence: opt.val })}>
              <div style={s.confidenceIcon}>{opt.icon}</div>
              <div style={s.confidenceOptionLabel}>{opt.label}</div>
              <div style={s.confidenceOptionSub}>{opt.sub}</div>
            </button>
          ))}
        </div>
        {buyer.confidence && confidenceNudge[buyer.confidence] && (
          <div style={s.confidenceNudge}>{confidenceNudge[buyer.confidence]}</div>
        )}
      </div>

    </div>
  )
}

function MoveField({ letter, label, question, value, onChange }) {
  const { start, stopAndReturn, listening, transcript } = useFreeVoice()
  const [fieldListening, setFieldListening] = useState(false)

  const handleMic = () => {
    if (fieldListening) {
      stopAndReturn((text) => { setFieldListening(false); if (text) onChange(text) })
    } else {
      setFieldListening(true)
      start((text) => { setFieldListening(false); if (text) onChange(text) })
    }
  }

  return (
    <div style={{ ...s.moveField, ...(value ? s.moveFieldFilled : {}) }}>
      <div style={s.moveFieldHeader}>
        <span style={s.moveFieldLetter}>{letter}</span>
        <div>
          <div style={s.moveFieldLabel}>{label}</div>
          <div style={s.moveFieldQuestion}>{question}</div>
        </div>
        <button style={{ ...s.moveFieldMic, ...(fieldListening ? s.moveFieldMicActive : {}) }} onClick={handleMic}>
          {fieldListening ? '⏹' : '🎙'}
        </button>
      </div>
      {fieldListening && transcript && <div style={s.moveFieldLive}>{transcript}</div>}
      <input style={s.moveFieldInput} value={value} placeholder="Type or speak →"
        onChange={e => onChange(e.target.value)} />
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
              {contact.isPrimary ? <span style={s.primaryBadge}>Primary</span> : <button style={s.setPrimaryBtn} onClick={setPrimary}>Set as primary</button>}
            </div>
            <div style={s.twoCol}>
              <div style={{ gridColumn: '1/-1' }}>
                <FL>Full Name</FL>
                <input style={s.field} value={contact.name} placeholder="Full name"
                  onChange={e => { upd('name', e.target.value); if (contact.isPrimary) updateBuyer({ clientName: e.target.value }) }} />
              </div>
              <div><FL>Phone</FL><input style={s.field} value={contact.phone} placeholder="(615) 000-0000" onChange={e => upd('phone', formatPhone(e.target.value))} /></div>
              <div><FL>Email</FL><input style={s.field} value={contact.email} placeholder="email@example.com" onChange={e => upd('email', e.target.value)} /></div>
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

// ─── SHOWINGS TAB ─────────────────────────────────────────────────────────────
function ShowingsTab({ buyer, openShowing, deleteShowing }) {
  const sorted = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date))
  return (
    <div style={s.pane}>
      {sorted.length === 0 ? (
        <div style={s.emptyState}>
          <div style={s.emptyTitle}>No showings yet</div>
          <div style={s.emptySub}>Log the first showing to start testing the MOVE.</div>
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
                  <div style={s.showingDate}>{sh.date ? new Date(sh.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}{sh.agentName ? ` · ${sh.agentName}` : ''}</div>
                  {sh.testingToday && <div style={s.showingTesting}><span style={s.showingTestingLabel}>Testing: </span>{sh.testingToday}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={s.ghostBtn} onClick={() => openShowing(sh)}>Edit</button>
                  <button style={s.dangerBtn} onClick={() => { if (window.confirm('Delete?')) deleteShowing(sh.id) }}>Delete</button>
                </div>
              </div>
              {sh.hypothesisUpdate && (
                <div style={s.nsUpdateBlock}>
                  <div style={s.nsUpdateLabel}>MOVE shift</div>
                  <div style={s.nsUpdateText}>{sh.hypothesisUpdate}</div>
                </div>
              )}
              <div style={s.debriefGrid}>
                {DEBRIEF_FIELDS.filter(d => d.key !== 'hypothesisUpdate').map(d => sh[d.key] ? (
                  <div key={d.key}><span style={s.debriefKey}>{d.label}: </span>{sh[d.key]}</div>
                ) : null)}
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
      {buyer.isMatch && (
        <div style={s.matchReveal}>
          <div style={s.matchRevealHeader}>
            <span style={s.matchRevealTitle}>✓ MOVE FOUND</span>
            <span style={s.matchRevealSub}>{buyer.showings.length} showings · {withUpdates.length} hypothesis shifts</span>
          </div>
          {ns.oneSentence && <div style={s.matchSentence}>{ns.oneSentence}</div>}
          <div style={s.matchRevealStory}>
            <div style={s.matchStoryItem}>
              <div style={s.matchStoryLabel}>Starting diagnosis</div>
              <div style={s.matchStoryTextOld}>{count > 0 ? `${ns.propertyType || '—'} in ${ns.location || '—'} · ${ns.motivation || '—'}` : 'Not yet built'}</div>
            </div>
            {withUpdates.map((sh, i) => (
              <div key={sh.id} style={s.matchStoryItem}>
                <div style={s.matchStoryLabel}>Showing {i + 1}{sh.address ? ` · ${sh.address}` : ''}</div>
                <div style={{ ...s.matchStoryText, ...(i === withUpdates.length - 1 ? s.matchStoryTextFinal : {}) }}>{sh.hypothesisUpdate}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={s.refinementsIntro}>How your team's understanding of their MOVE evolved. Every entry is the picture getting sharper.</div>

      {buyer.showings.length === 0 ? (
        <div style={s.emptySub}>Log showings to see the MOVE evolve here.</div>
      ) : (
        <div style={s.timeline}>
          <div style={s.timelineItem}>
            <div style={s.timelineDot} />
            <div>
              <div style={s.timelineLabel}>Starting diagnosis</div>
              <div style={s.timelineText}>{count > 0 ? `${ns.propertyType || '—'} in ${ns.location || '—'} · ${ns.motivation || '—'}` : <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Not yet built</span>}</div>
            </div>
          </div>
          {withUpdates.length === 0
            ? <div style={{ paddingLeft: 20, fontSize: 13, color: C.textMuted, fontStyle: 'italic' }}>No MOVE shifts yet.</div>
            : withUpdates.map((sh, i) => (
              <div key={sh.id} style={s.timelineItem}>
                <div style={s.timelineDot} />
                <div>
                  <div style={s.timelineLabel}>Showing {i+1}{sh.address ? ` · ${sh.address}` : ''}{sh.agentName ? ` · ${sh.agentName}` : ''}</div>
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
function ShowingForm({ draft, setDraft, onSave, onCancel, isEdit, buyer }) {
  const upd = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const { start, stopAndReturn, listening, transcript } = useFreeVoice()
  const [debriefListening, setDebriefListening] = useState(false)
  const [debriefProcessing, setDebriefProcessing] = useState(false)

  const runVoiceDebrief = () => {
    setDebriefListening(true)
    start((text) => { setDebriefListening(false); processVoiceDebrief(text) })
  }

  const stopVoiceDebrief = () => {
    stopAndReturn((text) => { setDebriefListening(false); processVoiceDebrief(text) })
  }

  const processVoiceDebrief = async (text) => {
    if (!text.trim()) return
    setDebriefProcessing(true)
    try {
      const res = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'intake', transcript: text }),
      })
      const data = await res.json()
      if (data.extracted) {
        const mapping = { motivation: 'respondedTo', outcome: 'moreTrue', veto: 'pulledBackFrom', exchange: 'hypothesisUpdate' }
        const updates = {}
        Object.entries(mapping).forEach(([from, to]) => { if (data.extracted[from]) updates[to] = data.extracted[from] })
        setDraft(d => ({ ...d, ...updates }))
      }
    } catch (_) {}
    setDebriefProcessing(false)
  }

  const ns = buyer?.northStar
  const moveSummary = ns?.oneSentence || [ns?.propertyType, ns?.location, ns?.motivation].filter(Boolean).join(' · ')

  return (
    <div style={s.formScreen}>
      <div style={s.formTopBar}>
        <button style={s.backBtn} onClick={onCancel}>← Back</button>
        <div style={s.formTopTitle}>{isEdit ? 'Edit Showing' : 'Log a Showing'}</div>
        <button style={s.voiceDebriefBtn} onClick={debriefListening ? stopVoiceDebrief : runVoiceDebrief}>
          {debriefListening ? '⏹ Done' : '🎙 Talk freely'}
        </button>
      </div>

      <div style={s.formScroll}>
        <div style={s.formBody}>

          {/* Current MOVE */}
          {moveSummary && (
            <div style={s.formMoveCard}>
              <div style={s.formMoveLabel}>CURRENT MOVE</div>
              <div style={s.formMoveText}>{moveSummary}</div>
            </div>
          )}

          {/* Coach prompt */}
          <div style={s.formCoachCard}>
            <div style={s.formCoachQ}>Did the MOVE get clearer?</div>
            <div style={s.formCoachSub}>Talk freely using the button above — AI will extract everything. Or fill in the fields below.</div>
          </div>

          {debriefListening && (
            <div style={s.formLiveText}>{transcript || <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Listening… speak freely about the showing.</span>}</div>
          )}
          {debriefProcessing && <div style={s.formProcessing}>✦ Extracting from what you said…</div>}

          {/* Date + agent */}
          <div style={s.twoCol}>
            <div><FL>Date</FL><input type="date" style={s.field} value={draft.date} onChange={e => upd('date', e.target.value)} /></div>
            <div><FL>Logged by</FL><input style={s.field} value={draft.agentName} placeholder="Agent name" onChange={e => upd('agentName', e.target.value)} /></div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <FL>Property Address</FL>
            <input style={s.field} value={draft.address} placeholder="123 Main St" onChange={e => upd('address', e.target.value)} />
          </div>

          {/* Pre-showing test */}
          <div style={{ marginBottom: 16 }}>
            <FL>What are you testing today?</FL>
            <input style={{ ...s.field, borderColor: C.gold }} value={draft.testingToday || ''} placeholder="e.g. Whether school proximity matters more than the home itself…"
              onChange={e => upd('testingToday', e.target.value)} />
          </div>

          {/* Debrief fields */}
          <div style={s.debriefSection}>
            <div style={s.debriefSectionLabel}>SHOWING DEBRIEF</div>
            {DEBRIEF_FIELDS.map(d => (
              <div key={d.key} style={{ marginBottom: 14 }}>
                <div style={s.debriefFieldRow}>
                  <div style={s.debriefFieldMeta}>
                    <span style={s.debriefFieldKey}>{d.label}</span>
                    <span style={s.debriefFieldQ}>{d.question}</span>
                  </div>
                </div>
                <textarea style={{ ...s.textarea, ...(d.key === 'hypothesisUpdate' ? { borderColor: C.gold, minHeight: 80 } : {}) }}
                  value={draft[d.key] || ''} onChange={e => upd(d.key, e.target.value)} />
              </div>
            ))}
          </div>

          <button style={s.saveShowingBtn} onClick={() => onSave(draft)}>Save Showing</button>
        </div>
      </div>
    </div>
  )
}

// ─── SHARED ───────────────────────────────────────────────────────────────────
function FL({ children }) { return <div style={s.fieldLabel}>{children}</div> }

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s = {
  screen:      { display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: "Georgia, 'Times New Roman', serif", overflow: 'hidden', color: C.text },
  buyerScreen: { display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: "Georgia, 'Times New Roman', serif", overflow: 'hidden', color: C.text },
  formScreen:  { display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: "Georgia, 'Times New Roman', serif", overflow: 'hidden', color: C.text },
  loadingScreen: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Georgia, serif', color: C.textMuted, fontSize: 14 },

  topBar:      { background: C.dark, padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
  topBarLeft:  {},
  brand:       { fontSize: 10, letterSpacing: '0.22em', color: C.gold, fontWeight: 'bold', marginBottom: 2 },
  brandSub:    { fontSize: 11, color: C.onDarkSub },
  topBarRight: { display: 'flex', alignItems: 'center', gap: 14 },
  agentLabel:  { fontSize: 12, color: C.onDarkMid },
  mindsetBtn:  { padding: '6px 12px', border: '1px solid #3c3835', borderRadius: 4, background: 'transparent', color: C.onDarkMid, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  addBuyerBtn: { padding: '7px 16px', border: 'none', borderRadius: 4, background: C.gold, color: C.dark, fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  signOutBtn:  { fontSize: 11, color: C.onDarkSub, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif' },

  mindsetBar:  { background: '#292524', borderBottom: '1px solid #3c3835', padding: '16px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px 28px', flexShrink: 0, overflowY: 'auto', maxHeight: 260 },
  mindsetSection: {},
  mindsetSectionTitle: { fontSize: 9, letterSpacing: '0.18em', color: C.gold, fontWeight: 'bold', marginBottom: 8 },
  mindsetText: { fontSize: 12, color: C.onDarkMid, lineHeight: 1.6 },
  mindsetMoveItem: { display: 'flex', gap: 8, marginBottom: 4 },
  mindsetMoveLetter: { fontSize: 12, color: C.gold, fontWeight: 'bold', minWidth: 12 },
  mindsetMoveText: { fontSize: 12, color: C.onDarkMid },
  mindsetPrepItem: { display: 'flex', gap: 8, marginBottom: 4 },
  mindsetPrepNum: { fontSize: 11, color: C.gold, minWidth: 14 },

  filterBar:    { background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0 },
  searchInput:  { padding: '7px 12px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.bg, fontSize: 13, fontFamily: 'Georgia, serif', color: C.text, outline: 'none', width: 180 },
  filterDivider:{ width: 1, height: 20, background: C.border },
  filterLabel:  { fontSize: 10, letterSpacing: '0.12em', color: C.textMuted, fontWeight: 'bold' },
  filterSelect: { padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.bg, fontSize: 12, fontFamily: 'Georgia, serif', color: C.text, cursor: 'pointer' },
  chips:        { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip:         { padding: '5px 11px', fontSize: 12, borderRadius: 4, border: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer', color: C.textMid, fontFamily: 'Georgia, serif' },
  chipActive:   { background: C.dark, color: C.gold, borderColor: C.dark, fontWeight: 'bold' },
  buyerCount:   { marginLeft: 'auto', fontSize: 12, color: C.textMuted },

  grid: { flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 16, alignContent: 'start' },

  card:          { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(28,25,23,0.06)' },
  cardFuzzy:     { borderColor: '#fca5a5' },
  cardMatch:     { borderColor: C.gold, boxShadow: `0 2px 12px rgba(184,150,46,0.15)` },
  cardTop:       { background: C.dark, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTopLeft:   {},
  cardName:      { fontSize: 15, color: C.onDark, fontWeight: 'bold', marginBottom: 2 },
  cardSpouse:    { fontSize: 12, color: C.onDarkSub, marginBottom: 2 },
  cardAgent:     { fontSize: 11, color: C.onDarkMid },
  statusBadge:   { fontSize: 10, padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap', marginTop: 2 },
  cardBody:      { padding: '14px 16px' },
  cardMatchBadge:{ fontSize: 11, color: C.gold, fontWeight: 'bold', letterSpacing: '0.08em', marginBottom: 8 },
  cardConfidence:{ marginBottom: 6 },
  cardFuzzyText: { fontSize: 11, color: '#dc2626', fontWeight: 'bold' },
  cardBuildingText: { fontSize: 11, color: '#d97706', fontWeight: 'bold' },
  cardSharpText: { fontSize: 11, color: '#16a34a', fontWeight: 'bold' },
  cardSentence:  { fontSize: 14, color: C.text, lineHeight: 1.6, marginBottom: 8 },
  cardSentenceEmpty: { fontSize: 13, color: C.textMuted, fontStyle: 'italic', marginBottom: 8 },
  cardLastUpdate: { fontSize: 12, color: C.textMid, background: C.bg, borderRadius: 4, padding: '6px 10px', lineHeight: 1.5 },
  cardLastUpdateLabel: { fontWeight: 'bold', color: C.gold },
  cardFooter:    { padding: '0 16px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardStat:      { fontSize: 11, color: C.textMuted },
  cardActions:   { display: 'flex', gap: 8 },
  cardLogBtn:    { padding: '8px 14px', background: C.dark, color: C.gold, border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  cardOpenBtn:   { padding: '8px 12px', background: C.bg, color: C.textMid, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  buyerTopBar:       { background: C.dark, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
  backBtn:           { fontSize: 12, color: C.gold, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  buyerTopRight:     { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  logShowingBtn:     { padding: '7px 14px', border: 'none', borderRadius: 4, background: C.gold, color: C.dark, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  markMatchBtn:      { padding: '7px 14px', border: `1px solid ${C.gold}`, borderRadius: 4, background: 'transparent', color: C.gold, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  unmatchBtn:        { padding: '7px 14px', border: '1px solid #3c3835', borderRadius: 4, background: 'transparent', color: C.onDarkSub, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  statusSelectDark:  { padding: '6px 10px', borderRadius: 4, border: '1px solid #3c3835', background: '#292524', fontSize: 12, fontFamily: 'Georgia, serif', cursor: 'pointer', color: C.onDarkMid },
  deleteBtnDark:     { padding: '6px 12px', borderRadius: 4, border: '1px solid #5a2020', background: 'transparent', color: '#f87171', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  buyerHeader:       { background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '14px 24px', flexShrink: 0 },
  buyerName:         { fontSize: 20, fontWeight: 'bold', color: C.text, marginBottom: 4 },
  buyerSpouse:       { fontSize: 15, color: C.textMid, fontWeight: 'normal' },
  buyerMeta:         { fontSize: 12, color: C.textMid, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  metaDot:           { color: C.border },
  statusPill:        { fontSize: 10, padding: '2px 7px', borderRadius: 4 },
  oneSentenceHeader: { fontSize: 14, color: C.text, lineHeight: 1.6, fontStyle: 'italic', borderLeft: `3px solid ${C.gold}`, paddingLeft: 12, marginTop: 4 },

  aiLoadBar:    { background: '#292524', padding: '9px 24px', flexShrink: 0 },
  aiLoadText:   { fontSize: 12, color: C.gold, fontStyle: 'italic' },

  aiPanel:        { background: C.goldLight, borderBottom: '1px solid #e6d4a0', padding: '12px 24px', flexShrink: 0 },
  aiPanelTop:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  aiPanelTitle:   { fontSize: 12, color: '#78501a', fontWeight: 'bold' },
  aiSentence:     { fontSize: 14, color: '#5a3a0a', fontStyle: 'italic', marginBottom: 8, lineHeight: 1.5 },
  aiChanges:      { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 },
  aiChange:       { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 13 },
  aiChangeField:  { fontSize: 10, letterSpacing: '0.08em', color: C.gold, fontWeight: 'bold', textTransform: 'uppercase', minWidth: 130, flexShrink: 0 },
  aiChangePrev:   { color: C.textMuted, textDecoration: 'line-through', fontSize: 12 },
  aiChangeArrow:  { color: C.gold, fontWeight: 'bold', flexShrink: 0 },
  aiChangeNext:   { color: '#5a3a0a', fontWeight: 'bold', fontSize: 13 },
  aiUndoBtn:      { padding: '4px 10px', border: '1px solid #c9a84c', borderRadius: 4, background: 'transparent', color: '#78501a', fontSize: 11, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  aiDismissBtn:   { fontSize: 14, color: '#a8925a', background: 'none', border: 'none', cursor: 'pointer' },
  coachingQ:      { fontSize: 13, color: '#78501a', borderTop: '1px solid #e6d4a0', paddingTop: 8, lineHeight: 1.5 },
  coachingQLabel: { fontWeight: 'bold' },

  tabBar:    { display: 'flex', borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.surface, overflowX: 'auto' },
  tab:       { padding: '11px 18px', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontSize: 13, cursor: 'pointer', color: C.textMuted, fontFamily: 'Georgia, serif', marginBottom: -1, whiteSpace: 'nowrap' },
  tabActive: { color: C.text, borderBottomColor: C.gold, fontWeight: 'bold' },
  tabContent:{ flex: 1, overflowY: 'auto', padding: '24px' },
  pane:      { maxWidth: 860 },

  // Intake panel
  intakePanel:       { background: C.dark, borderRadius: 10, padding: '18px 20px', marginBottom: 20 },
  intakePanelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  intakePanelTitle:  { fontSize: 9, letterSpacing: '0.18em', color: C.gold, fontWeight: 'bold' },
  intakePanelClose:  { fontSize: 11, color: C.onDarkSub, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  intakePrepNote:    { fontSize: 12, color: C.onDarkMid, marginBottom: 10 },
  prepList:          { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  prepItem:          { display: 'flex', gap: 10, alignItems: 'flex-start' },
  prepNum:           { fontSize: 11, color: C.gold, fontWeight: 'bold', minWidth: 16, marginTop: 1 },
  prepQ:             { fontSize: 13, color: C.onDark, lineHeight: 1.5 },
  intakeDivider:     { fontSize: 11, color: C.onDarkSub, borderTop: '1px solid #3c3835', paddingTop: 14, marginBottom: 12 },
  intakePrompt:      { fontSize: 16, color: C.onDark, fontWeight: 'bold', marginBottom: 14, lineHeight: 1.4 },
  intakeLiveText:    { background: '#292524', borderRadius: 5, padding: '10px 12px', fontSize: 13, color: C.onDark, lineHeight: 1.6, marginTop: 10, minHeight: 60 },
  intakeHint:        { fontSize: 11, color: C.onDarkSub, marginTop: 8, textAlign: 'center' },
  intakeReviewLabel: { fontSize: 10, letterSpacing: '0.1em', color: C.onDarkSub, marginBottom: 6 },
  intakeReviewText:  { background: '#292524', borderRadius: 5, padding: '10px 12px', fontSize: 13, color: C.onDark, lineHeight: 1.6, marginBottom: 12, minHeight: 60 },
  intakeReviewActions:{ display: 'flex', gap: 10 },
  intakeProcessing:  { fontSize: 13, color: C.gold, fontStyle: 'italic', padding: '8px 0' },
  micBtnReady:       { width: '100%', padding: '13px', background: C.gold, color: C.dark, border: 'none', borderRadius: 7, fontSize: 15, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  micBtnActive:      { width: '100%', padding: '13px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, fontSize: 15, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },

  moveCoachRow:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  moveCoachMsg:    { fontSize: 13, color: C.textMid, fontStyle: 'italic' },
  voiceIntakeBtn:  { padding: '7px 14px', border: `1px solid ${C.border}`, borderRadius: 5, background: C.surface, color: C.text, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif', whiteSpace: 'nowrap' },

  oneSentenceCard:  { background: C.goldLight, border: `1px solid #e6d4a0`, borderLeft: `3px solid ${C.gold}`, borderRadius: 6, padding: '12px 16px', marginBottom: 20 },
  oneSentenceLabel: { fontSize: 9, letterSpacing: '0.14em', color: C.gold, fontWeight: 'bold', marginBottom: 6 },
  oneSentenceText:  { fontSize: 15, color: C.text, lineHeight: 1.6, fontStyle: 'italic' },

  moveWord:    { fontSize: 32, fontWeight: 'bold', color: C.dark, letterSpacing: '0.16em', marginBottom: 14 },
  moveGrid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 },
  moveField:        { border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px', background: C.surface },
  moveFieldFilled:  { borderColor: '#d4b060', background: C.goldLight },
  moveFieldHeader:  { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  moveFieldLetter:  { fontSize: 24, fontWeight: 'bold', color: C.gold, lineHeight: 1, flexShrink: 0 },
  moveFieldLabel:   { fontSize: 11, fontWeight: 'bold', color: C.text, letterSpacing: '0.06em' },
  moveFieldQuestion:{ fontSize: 11, color: C.textMuted, marginTop: 2 },
  moveFieldMic:     { marginLeft: 'auto', padding: '4px 8px', background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer', fontSize: 13, color: C.textMuted, flexShrink: 0 },
  moveFieldMicActive:{ background: '#fee2e2', borderColor: '#fca5a5', color: '#dc2626' },
  moveFieldLive:    { fontSize: 12, color: C.textMid, fontStyle: 'italic', marginBottom: 6, padding: '6px 8px', background: C.bg, borderRadius: 3 },
  moveFieldInput:   { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 5, background: C.bg, fontSize: 13, fontFamily: 'Georgia, serif', color: C.text, outline: 'none' },
  moveLocationGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px', marginBottom: 20 },

  confidenceSection:     { marginBottom: 4 },
  confidenceLabel:       { fontSize: 13, color: C.textMid, marginBottom: 10 },
  confidenceOptions:     { display: 'flex', gap: 10, marginBottom: 10 },
  confidenceOption:      { flex: 1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 10px', textAlign: 'center', background: C.surface, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  confidenceOptionActive:{ borderColor: C.gold, background: C.goldLight },
  confidenceIcon:        { fontSize: 20, marginBottom: 4 },
  confidenceOptionLabel: { fontSize: 12, color: C.text, fontWeight: 'bold', marginBottom: 3 },
  confidenceOptionSub:   { fontSize: 10, color: C.textMuted },
  confidenceNudge:       { background: C.goldLight, border: `1px solid #e6d4a0`, borderLeft: `3px solid ${C.gold}`, borderRadius: 4, padding: '10px 12px', fontSize: 13, color: '#78501a', lineHeight: 1.6 },

  contactCard:        { border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px', marginBottom: 14, background: C.surface },
  contactCardPrimary: { borderColor: C.gold, background: C.goldLight },
  contactCardTop:     { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 },
  roleInput:          { fontSize: 11, fontWeight: 'bold', letterSpacing: '0.08em', color: C.textMid, background: 'transparent', border: 'none', borderBottom: `1px dashed ${C.border}`, outline: 'none', padding: '2px 4px', fontFamily: 'Georgia, serif', textTransform: 'uppercase', width: 160 },
  primaryBadge:       { fontSize: 10, background: C.dark, color: C.gold, padding: '2px 8px', borderRadius: 10 },
  setPrimaryBtn:      { fontSize: 10, background: 'none', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textMuted, padding: '2px 8px', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  twoCol:             { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' },

  fieldLabel: { fontSize: 11, letterSpacing: '0.06em', color: C.textMuted, textTransform: 'uppercase', marginBottom: 5 },
  field:      { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 5, background: C.bg, fontSize: 14, fontFamily: 'Georgia, serif', color: C.text, outline: 'none' },
  fieldFilled:{ background: C.goldLight, borderColor: '#d4b060', color: C.dark },
  textarea:   { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 5, background: C.bg, fontSize: 14, fontFamily: 'Georgia, serif', color: C.text, outline: 'none', resize: 'vertical', minHeight: 80, lineHeight: 1.6 },

  showingCard:    { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px', marginBottom: 14 },
  showingCardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  showingAddr:    { fontSize: 15, fontWeight: 'bold', color: C.text },
  showingDate:    { fontSize: 12, color: C.textMuted, marginTop: 2 },
  showingTesting: { fontSize: 12, color: C.textMid, marginTop: 4, fontStyle: 'italic' },
  showingTestingLabel: { fontWeight: 'bold', color: C.gold, fontStyle: 'normal' },
  nsUpdateBlock:  { background: C.goldLight, border: `1px solid #e6d4a0`, borderLeft: `3px solid ${C.gold}`, borderRadius: 4, padding: '10px 12px', marginBottom: 10 },
  nsUpdateLabel:  { fontSize: 9, letterSpacing: '0.12em', color: C.gold, fontWeight: 'bold', marginBottom: 4 },
  nsUpdateText:   { fontSize: 13, color: C.text, lineHeight: 1.5 },
  debriefGrid:    { fontSize: 13, color: C.textMid, lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 4 },
  debriefKey:     { fontWeight: 'bold', color: C.text },

  refinementsIntro: { fontSize: 14, color: C.textMid, fontStyle: 'italic', marginBottom: 24, padding: '12px 16px', background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, lineHeight: 1.6 },
  timeline:         { borderLeft: `2px solid ${C.border}`, paddingLeft: 22, marginLeft: 6 },
  timelineItem:     { position: 'relative', paddingBottom: 22, display: 'flex', gap: 14 },
  timelineDot:      { width: 10, height: 10, borderRadius: '50%', background: C.gold, flexShrink: 0, marginTop: 3, marginLeft: -26 },
  timelineLabel:    { fontSize: 11, color: C.textMuted, marginBottom: 4 },
  timelineText:     { fontSize: 14, color: C.text, lineHeight: 1.6 },

  matchReveal:       { background: C.goldLight, border: `1px solid #e6d4a0`, borderRadius: 10, padding: '16px 18px', marginBottom: 20 },
  matchRevealHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  matchRevealTitle:  { fontSize: 13, fontWeight: 'bold', color: '#78501a', letterSpacing: '0.08em' },
  matchRevealSub:    { fontSize: 12, color: '#a8925a' },
  matchSentence:     { fontSize: 15, color: '#5a3a0a', fontStyle: 'italic', marginBottom: 14, lineHeight: 1.6 },
  matchRevealStory:  { borderLeft: '2px solid #e6d4a0', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  matchStoryItem:    {},
  matchStoryLabel:   { fontSize: 10, color: '#a8925a', letterSpacing: '0.06em', marginBottom: 3 },
  matchStoryTextOld: { fontSize: 13, color: '#a8a29e', textDecoration: 'line-through' },
  matchStoryText:    { fontSize: 13, color: C.textMid, lineHeight: 1.5 },
  matchStoryTextFinal:{ fontSize: 15, color: C.dark, fontWeight: 'bold', lineHeight: 1.5 },

  formTopBar:       { background: C.dark, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
  formTopTitle:     { fontSize: 14, color: C.onDark, fontWeight: 'bold' },
  voiceDebriefBtn:  { padding: '7px 14px', border: `1px solid ${C.gold}`, borderRadius: 5, background: 'transparent', color: C.gold, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  formScroll:       { flex: 1, overflowY: 'auto' },
  formBody:         { padding: '24px', maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 0 },
  formMoveCard:     { background: C.goldLight, border: `1px solid #e6d4a0`, borderLeft: `3px solid ${C.gold}`, borderRadius: 6, padding: '12px 14px', marginBottom: 16 },
  formMoveLabel:    { fontSize: 9, letterSpacing: '0.14em', color: C.gold, fontWeight: 'bold', marginBottom: 4 },
  formMoveText:     { fontSize: 14, color: C.text, lineHeight: 1.5, fontStyle: 'italic' },
  formCoachCard:    { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '12px 14px', marginBottom: 16 },
  formCoachQ:       { fontSize: 15, color: C.dark, fontWeight: 'bold', marginBottom: 4 },
  formCoachSub:     { fontSize: 12, color: C.textMid, lineHeight: 1.5 },
  formLiveText:     { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: '12px 14px', fontSize: 13, color: C.text, lineHeight: 1.6, marginBottom: 14, minHeight: 80 },
  formProcessing:   { fontSize: 13, color: C.gold, fontStyle: 'italic', padding: '8px 0', marginBottom: 8 },
  debriefSection:   { display: 'flex', flexDirection: 'column', gap: 0 },
  debriefSectionLabel: { fontSize: 10, letterSpacing: '0.16em', color: C.textMuted, fontWeight: 'bold', paddingBottom: 10, borderBottom: `1px solid ${C.border}`, marginBottom: 14 },
  debriefFieldRow:  { marginBottom: 6 },
  debriefFieldMeta: { display: 'flex', alignItems: 'baseline', gap: 8 },
  debriefFieldKey:  { fontSize: 12, fontWeight: 'bold', color: C.text },
  debriefFieldQ:    { fontSize: 11, color: C.textMuted },
  saveShowingBtn:   { width: '100%', padding: '14px', border: 'none', borderRadius: 8, background: C.dark, color: C.gold, fontSize: 16, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold', marginTop: 8 },

  primaryBtn: { padding: '9px 20px', border: 'none', borderRadius: 5, background: C.dark, color: C.gold, fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  ghostBtn:   { padding: '7px 14px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface, color: C.textMid, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  dangerBtn:  { padding: '7px 14px', borderRadius: 5, border: '1px solid #fca5a5', background: C.surface, color: '#dc2626', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  emptyGrid:  { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: C.text, marginBottom: 8 },
  emptySub:   { fontSize: 14, color: C.textMuted, marginBottom: 20, lineHeight: 1.6 },
}
