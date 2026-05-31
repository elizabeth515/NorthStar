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
      // Reload from DB after save to ensure local state matches server
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
    setTab('showings')

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
        <AiUpdatePanel notification={aiNotification} onUndo={() => undoAI(aiNotification.previous)} onDismiss={() => setAiNotification(null)} />
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


// ─── VOICE INTERVIEW ─────────────────────────────────────────────────────────
function useVoiceField(onResult) {
  const recogRef = useRef(null)
  const silenceTimer = useRef(null)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')

  const stop = () => {
    if (recogRef.current) { try { recogRef.current.stop() } catch (_) {} }
    if (silenceTimer.current) clearTimeout(silenceTimer.current)
    setListening(false)
  }

  const start = (onDone) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Voice input is not supported in this browser. Use Chrome or Safari.'); return }
    const r = new SR()
    r.continuous = true
    r.interimResults = true
    r.lang = 'en-US'
    recogRef.current = r
    let final = ''

    r.onstart = () => { setListening(true); setTranscript('') }

    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim = t
      }
      setTranscript(final + interim)
      if (silenceTimer.current) clearTimeout(silenceTimer.current)
      silenceTimer.current = setTimeout(() => {
        r.stop()
        onDone(final || interim)
      }, 5000)
    }

    r.onerror = () => stop()
    r.onend = () => { setListening(false); if (silenceTimer.current) clearTimeout(silenceTimer.current) }
    r.start()
  }

  return { start, stop, listening, transcript }
}

// Interview session: walks through questions one by one
function VoiceInterview({ questions, onComplete, onClose }) {
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState(questions.map(() => ''))
  const answersRef = useRef(questions.map(() => ''))
  const idxRef = useRef(0)
  const [phase, setPhase] = useState('ready') // ready | listening | done
  const { start, stop, listening, transcript } = useVoiceField()

  const current = questions[idx]

  const advance = (updatedAnswers) => {
    const nextIdx = idxRef.current + 1
    if (nextIdx < questions.length) {
      setTimeout(() => {
        idxRef.current = nextIdx
        setIdx(nextIdx)
        setPhase('ready')
      }, 400)
    } else {
      setPhase('done')
      onComplete(updatedAnswers)
    }
  }

  const startListening = () => {
    setPhase('listening')
    start((answer) => {
      const updated = [...answersRef.current]
      updated[idxRef.current] = answer
      answersRef.current = updated
      setAnswers([...updated])
      advance(updated)
    })
  }

  const skip = () => {
    stop()
    const updated = [...answersRef.current]
    const nextIdx = idxRef.current + 1
    if (nextIdx < questions.length) {
      idxRef.current = nextIdx
      setIdx(nextIdx)
      setPhase('ready')
    } else {
      setPhase('done')
      onComplete(updated)
    }
  }

  const restart = (i) => { stop(); idxRef.current = i; setIdx(i); setPhase('ready') }

  if (phase === 'done') {
    return (
      <div style={vs.overlay}>
        <div style={vs.panel}>
          <div style={vs.header}>
            <div style={vs.headerTitle}>Review your answers</div>
            <button style={vs.closeBtn} onClick={onClose}>✕</button>
          </div>
          <div style={vs.reviewList}>
            {questions.map((q, i) => (
              <div key={i} style={vs.reviewItem}>
                <div style={vs.reviewQ}>{q.label}</div>
                <div style={vs.reviewA}>{answers[i] || <span style={{ color: '#a8a29e', fontStyle: 'italic' }}>Skipped</span>}</div>
                <button style={vs.editAnswerBtn} onClick={() => restart(i)}>Re-record</button>
              </div>
            ))}
          </div>
          <div style={vs.reviewActions}>
            <button style={vs.saveBtn} onClick={() => { onComplete(answers); onClose() }}>Save All Answers</button>
            <button style={vs.cancelBtn} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={vs.overlay}>
      <div style={vs.panel}>
        <div style={vs.header}>
          <div style={vs.progress}>{idx + 1} of {questions.length}</div>
          <button style={vs.closeBtn} onClick={() => { stop(); onClose() }}>✕</button>
        </div>
        <div style={vs.progressBar}>
          <div style={{ ...vs.progressFill, width: `${((idx) / questions.length) * 100}%` }} />
        </div>

        <div style={vs.questionArea}>
          <div style={vs.questionText}>{current.prompt}</div>
          {phase === 'listening' && (
            <div style={vs.transcriptBox}>
              {transcript || <span style={{ color: '#a8a29e', fontStyle: 'italic' }}>Listening…</span>}
            </div>
          )}
          {phase === 'ready' && answers[idx] && (
            <div style={vs.prevAnswer}>Previous: {answers[idx]}</div>
          )}
        </div>

        <div style={vs.controls}>
          {phase === 'ready' && (
            <button style={vs.micBtn} onClick={startListening}>
              <span style={vs.micIcon}>🎙</span>
              <span>Tap to answer</span>
            </button>
          )}
          {phase === 'listening' && (
            <button style={vs.micBtnActive} onClick={() => { stop(); advance(answersRef.current) }}>
              <span style={vs.micIcon}>⏹</span>
              <span>Done speaking</span>
            </button>
          )}
          {phase === 'ready' && (
            <button style={vs.skipBtn} onClick={skip}>
              {idx < questions.length - 1 ? 'Skip question' : 'End interview'}
            </button>
          )}
        </div>

        <div style={vs.hint}>
          {phase === 'listening' ? 'Speaking… pause 5 seconds to move on automatically.' : 'Tap the mic and speak your answer naturally.'}
        </div>
      </div>
    </div>
  )
}

// Mic button for individual fields
function MicButton({ prompt, onResult }) {
  const [open, setOpen] = useState(false)
  if (!open) return (
    <button style={vs.inlineMic} title={prompt} onClick={() => setOpen(true)}>🎙</button>
  )
  return (
    <VoiceInterview
      questions={[{ prompt, label: prompt }]}
      onComplete={([ans]) => { if (ans) onResult(ans); setOpen(false) }}
      onClose={() => setOpen(false)}
    />
  )
}

const vs = {
  overlay:      { position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  panel:        { background: '#fff', borderRadius: 12, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', fontFamily: "Georgia, serif" },
  header:       { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px 10px' },
  headerTitle:  { fontSize: 14, fontWeight: 'bold', color: '#1c1917' },
  progress:     { fontSize: 12, color: '#a8a29e', letterSpacing: '0.06em' },
  closeBtn:     { fontSize: 16, color: '#a8a29e', background: 'none', border: 'none', cursor: 'pointer' },
  progressBar:  { height: 3, background: '#f0ebe3', margin: '0 20px 24px' },
  progressFill: { height: '100%', background: '#b8962e', borderRadius: 2, transition: 'width 0.3s' },
  questionArea: { padding: '0 24px 24px' },
  questionText: { fontSize: 18, color: '#1c1917', lineHeight: 1.5, marginBottom: 16, fontWeight: 'bold' },
  transcriptBox:{ background: '#faf7f2', border: '1px solid #e8e2d9', borderRadius: 6, padding: '12px 14px', fontSize: 14, color: '#1c1917', minHeight: 80, lineHeight: 1.6 },
  prevAnswer:   { fontSize: 13, color: '#78716c', fontStyle: 'italic', padding: '8px 12px', background: '#faf7f2', borderRadius: 4 },
  controls:     { display: 'flex', gap: 12, padding: '0 24px 16px', alignItems: 'center' },
  micBtn:       { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px', background: '#1c1917', color: '#b8962e', border: 'none', borderRadius: 8, fontSize: 15, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  micBtnActive: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  micIcon:      { fontSize: 20 },
  skipBtn:      { padding: '12px 16px', border: '1px solid #e8e2d9', borderRadius: 8, background: '#fff', color: '#78716c', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  hint:         { fontSize: 12, color: '#a8a29e', textAlign: 'center', padding: '0 24px 20px', lineHeight: 1.5 },
  inlineMic:    { padding: '4px 8px', background: 'none', border: '1px solid #e8e2d9', borderRadius: 4, cursor: 'pointer', fontSize: 14, color: '#a8a29e', marginLeft: 6, flexShrink: 0 },
  reviewList:   { padding: '0 24px', maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 },
  reviewItem:   { borderBottom: '1px solid #f0ebe3', paddingBottom: 12 },
  reviewQ:      { fontSize: 11, letterSpacing: '0.08em', color: '#a8a29e', textTransform: 'uppercase', marginBottom: 4 },
  reviewA:      { fontSize: 14, color: '#1c1917', lineHeight: 1.5, marginBottom: 6 },
  editAnswerBtn:{ fontSize: 11, color: '#b8962e', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif', padding: 0 },
  reviewActions:{ display: 'flex', gap: 10, padding: '16px 24px 20px' },
  saveBtn:      { flex: 1, padding: '11px', background: '#1c1917', color: '#b8962e', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  cancelBtn:    { padding: '11px 16px', border: '1px solid #e8e2d9', borderRadius: 6, background: '#fff', color: '#78716c', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif' },
}

// ─── NORTH STAR TAB ───────────────────────────────────────────────────────────
function NorthStarTab({ buyer, updateNS }) {
  const ns = buyer.northStar
  const count = nsComplete(ns)
  const [voiceOpen, setVoiceOpen] = useState(false)

  const nsQuestions = [
    { key: 'propertyType', prompt: 'What type of home are they looking for?', label: 'Property Type' },
    { key: 'location', prompt: 'What neighborhood or area are they focused on?', label: 'Location' },
    { key: 'motivation', prompt: "What's driving this move — what are they trying to accomplish?", label: 'Core Motivation' },
    { key: 'whatMattersMost', prompt: 'What matters most to them in a home?', label: 'What Matters Most' },
    { key: 'willingToTrade', prompt: "What are they willing to give up?", label: 'Will Give Up' },
    { key: 'tradeFor', prompt: 'What do they get in return for that trade?', label: 'In Exchange For' },
  ]

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
      {voiceOpen && (
        <VoiceInterview
          questions={nsQuestions}
          onComplete={(answers) => { nsQuestions.forEach((q, i) => { if (answers[i]) updateNS(q.key, answers[i]) }) }}
          onClose={() => setVoiceOpen(false)}
        />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div style={{ ...s.coachCard, background: coach.bg, flex: 1, marginRight: 12, marginBottom: 0 }}>
          <span style={{ fontSize: 13, color: coach.color, lineHeight: 1.6 }}>{coach.msg}</span>
        </div>
        <button style={s.voiceInterviewBtn} onClick={() => setVoiceOpen(true)}>🎙 Voice Interview</button>
      </div>
      <div style={{ marginBottom: 16 }} />

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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <FL>{f.label}</FL>
              <MicButton prompt={f.placeholder.replace('e.g. ', 'e.g., ')} onResult={v => updateNS(f.key, v)} />
            </div>
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
  const [voiceOpen, setVoiceOpen] = useState(false)
  const profileQuestions = [
    { key: 'friction', prompt: "What's broken or painful in their current situation — what are they moving away from?", label: 'The Friction' },
    { key: 'gain', prompt: 'What does success look like for them — what are they moving toward?', label: 'The Gain' },
    { key: 'nonNegotiables', prompt: 'What kills a house immediately for them — any hard limits or deal-breakers?', label: 'Non-Negotiables' },
    { key: 'patterns', prompt: 'What themes keep coming up in your conversations with them?', label: 'Patterns' },
  ]
  return (
    <div style={s.pane}>
      {voiceOpen && (
        <VoiceInterview
          questions={profileQuestions}
          onComplete={(answers) => { profileQuestions.forEach((q, i) => { if (answers[i]) updateProfile(q.key, answers[i]) }) }}
          onClose={() => setVoiceOpen(false)}
        />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={s.profileNote}>These four inputs build the foundation. They feed directly into the North Star.</div>
        <button style={s.voiceInterviewBtn} onClick={() => setVoiceOpen(true)}>🎙 Voice Interview</button>
      </div>
      {[
        { key: 'friction', label: 'The Friction — what are they moving away from?', placeholder: 'What\'s broken or unsustainable in their current situation?' },
        { key: 'gain', label: 'The Gain — what are they moving toward?', placeholder: 'What does success look like for them?' },
        { key: 'nonNegotiables', label: 'Non-Negotiables — what kills a house immediately?', placeholder: 'Hard limits, deal-breakers…' },
        { key: 'patterns', label: 'Patterns — what keeps coming up?', placeholder: 'Recurring themes, consistent reactions…' },
      ].map(f => (
        <div key={f.key} style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <FL>{f.label}</FL>
            <MicButton prompt={f.prompt} onResult={v => updateProfile(f.key, v)} />
          </div>
          <textarea style={s.textarea} value={buyer.profile[f.key]} placeholder={f.placeholder} onChange={e => updateProfile(f.key, e.target.value)} />
        </div>
      ))}
    </div>
  )
}

// ─── AI UPDATE PANEL ─────────────────────────────────────────────────────────
const NS_LABELS = {
  propertyType: 'Property Type',
  location: 'Location',
  motivation: 'Core Motivation',
  whatMattersMost: 'What Matters Most',
  willingToTrade: 'Will Give Up',
  tradeFor: 'In Exchange For',
}

function AiUpdatePanel({ notification, onUndo, onDismiss }) {
  const { applied, previous } = notification
  const changed = Object.keys(applied).filter(k => applied[k] !== previous[k] && applied[k])

  return (
    <div style={s.aiPanel}>
      <div style={s.aiPanelTop}>
        <span style={s.aiPanelTitle}>✦ North Star updated from showing</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={s.aiUndoBtn} onClick={onUndo}>Undo all</button>
          <button style={s.aiDismissBtn} onClick={onDismiss}>✕</button>
        </div>
      </div>
      <div style={s.aiChanges}>
        {changed.map(k => (
          <div key={k} style={s.aiChange}>
            <span style={s.aiChangeField}>{NS_LABELS[k]}</span>
            <span style={s.aiChangePrev}>{previous[k] || <em style={{ color: C.textMuted }}>was empty</em>}</span>
            <span style={s.aiChangeArrow}>→</span>
            <span style={s.aiChangeNext}>{applied[k]}</span>
          </div>
        ))}
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
  const [voiceOpen, setVoiceOpen] = useState(false)
  const showingQuestions = [
    { key: 'respondedTo', prompt: 'What did they gravitate toward — what features, rooms, or moments created energy?', label: 'Responded To' },
    { key: 'pulledBackFrom', prompt: 'What did they pull back from — what did they question, dismiss, or hesitate on?', label: 'Pulled Back From' },
    { key: 'moreTrue', prompt: 'What feels more true about your hypothesis now — what confirmed what you believed?', label: 'More True' },
    { key: 'lessTrue', prompt: 'What feels less true — what challenged your hypothesis?', label: 'Less True' },
    { key: 'hypothesisUpdate', prompt: 'How does the North Star change based on this showing? Speak your update.', label: 'North Star Update' },
  ]
  return (
    <div style={s.formScreen}>
      {voiceOpen && (
        <VoiceInterview
          questions={showingQuestions}
          onComplete={(answers) => { showingQuestions.forEach((q, i) => { if (answers[i]) upd(q.key, answers[i]) }) }}
          onClose={() => setVoiceOpen(false)}
        />
      )}
      <div style={s.formTopBar}>
        <button style={s.backBtn} onClick={onCancel}>← Back</button>
        <div style={s.formTopTitle}>{isEdit ? 'Edit Showing' : 'Log a Showing'}</div>
        <button style={s.voiceInterviewBtnDark} onClick={() => setVoiceOpen(true)}>🎙 Voice Debrief</button>
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
  aiLoadBar:      { background: '#292524', padding: '9px 24px', flexShrink: 0, borderBottom: '1px solid #3c3835' },
  aiLoadText:     { fontSize: 12, color: C.gold, fontStyle: 'italic' },
  aiPanel:        { background: C.goldLight, borderBottom: '1px solid #e6d4a0', padding: '12px 24px', flexShrink: 0 },
  aiPanelTop:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  aiPanelTitle:   { fontSize: 13, color: '#78501a', fontWeight: 'bold' },
  aiChanges:      { display: 'flex', flexDirection: 'column', gap: 6 },
  aiChange:       { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 13 },
  aiChangeField:  { fontSize: 10, letterSpacing: '0.08em', color: C.gold, fontWeight: 'bold', textTransform: 'uppercase', minWidth: 130, flexShrink: 0 },
  aiChangePrev:   { color: C.textMuted, textDecoration: 'line-through', fontSize: 13 },
  aiChangeArrow:  { color: C.gold, fontWeight: 'bold', flexShrink: 0 },
  aiChangeNext:   { color: '#5a3a0a', fontWeight: 'bold', fontSize: 13 },
  aiUndoBtn:      { padding: '5px 12px', border: '1px solid #c9a84c', borderRadius: 4, background: 'transparent', color: '#78501a', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  aiDismissBtn:   { fontSize: 14, color: '#a8925a', background: 'none', border: 'none', cursor: 'pointer' },

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

  // Voice button
  voiceInterviewBtn:     { padding: '7px 14px', border: '1px solid #e8e2d9', borderRadius: 5, background: '#fff', color: '#1c1917', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif', whiteSpace: 'nowrap', flexShrink: 0 },
  voiceInterviewBtnDark: { padding: '7px 14px', border: '1px solid #3c3835', borderRadius: 5, background: 'transparent', color: C.gold, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif', whiteSpace: 'nowrap' },

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
