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
  const [view, setView] = useState('snapshot') // snapshot | buyer | showing
  const [tab, setTab] = useState('northstar')
  const [search, setSearch] = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showingDraft, setShowingDraft] = useState(null)
  const [editingShowingId, setEditingShowingId] = useState(null)
  const [aiSuggestions, setAiSuggestions] = useState(null)
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

  const applyAISuggestions = useCallback((suggestions) => {
    setBuyers(p => p.map(b => {
      if (b.id !== selectedId) return b
      const nb = { ...b, northStar: { ...b.northStar, ...suggestions } }
      debouncedSave(nb)
      return nb
    }))
    setAiSuggestions(null)
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

    // Trigger AI suggestion if debrief has content
    if (updatedBuyer && (showing.respondedTo || showing.pulledBackFrom || showing.moreTrue || showing.lessTrue || showing.hypothesisUpdate)) {
      setAiLoading(true)
      try {
        const res = await fetch('/api/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ northStar: updatedBuyer.northStar, showing }),
        })
        const data = await res.json()
        if (data.suggestions) setAiSuggestions(data.suggestions)
      } catch (_) {}
      setAiLoading(false)
    }
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
    setAiSuggestions(null)
  }

  const selectBuyer = (id, targetTab = 'northstar') => {
    setSelectedId(id)
    setTab(targetTab)
    setView('buyer')
    setAiSuggestions(null)
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

  if (loading) return <div style={s.loadingScreen}>Loading...</div>

  // ── SHOWING FORM ──
  if (view === 'showing' && showingDraft) {
    return <ShowingForm
      draft={showingDraft} setDraft={setShowingDraft}
      onSave={saveShowing} onCancel={() => { setView('buyer'); setShowingDraft(null) }}
      isEdit={!!editingShowingId}
    />
  }

  // ── BUYER DETAIL ──
  if (view === 'buyer' && selected) {
    return <BuyerView
      buyer={selected} agents={agents} currentAgent={currentAgent} saving={saving}
      tab={tab} setTab={setTab}
      aiSuggestions={aiSuggestions} aiLoading={aiLoading}
      setAiSuggestions={setAiSuggestions}
      updateBuyer={updateBuyer} updateNS={updateNS} updateProfile={updateProfile}
      applyAISuggestions={applyAISuggestions}
      saveShowing={saveShowing} deleteShowing={deleteShowing} deleteBuyer={deleteBuyer}
      openShowing={openShowing}
      onBack={() => setView('snapshot')}
      mindsetOpen={mindsetOpen} setMindsetOpen={setMindsetOpen}
    />
  }

  // ── SNAPSHOT ──
  return (
    <div style={s.screen}>
      <div style={s.snapshotHeader}>
        <div style={s.snapshotTopRow}>
          <div>
            <div style={s.brand}>BUILD THE HOUSE</div>
            <div style={s.brandSub}>Buyer Framework</div>
          </div>
          <div style={s.snapshotHeaderRight}>
            <span style={s.agentName}>{currentAgent?.name || session.user.email}</span>
            <button style={s.mindsetNavBtn} onClick={() => setMindsetOpen(o => !o)}>Mindset</button>
            <button style={s.addBuyerBtn} onClick={addBuyer}>+ New Buyer</button>
            <button style={s.signOutBtn} onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>

        {mindsetOpen && (
          <div style={s.mindsetDrawer}>
            <div style={s.mindsetGrid}>
              {MINDSET.map(m => (
                <div key={m.title} style={s.mindsetItem}>
                  <div style={s.mindsetTitle}>{m.title}</div>
                  <div style={s.mindsetBody}>{m.body}</div>
                </div>
              ))}
            </div>
            <button style={s.closeMindset} onClick={() => setMindsetOpen(false)}>Close</button>
          </div>
        )}

        <div style={s.filterBar}>
          <input style={s.searchInput} placeholder="Search buyers..." value={search} onChange={e => setSearch(e.target.value)} />
          <div style={s.filterDivider} />
          <span style={s.filterLabel}>AGENT</span>
          <select style={s.agentSelect} value={agentFilter} onChange={e => setAgentFilter(e.target.value)}>
            <option value="all">All Agents</option>
            {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
          <div style={s.filterDivider} />
          <span style={s.filterLabel}>STATUS</span>
          <div style={s.statusChips}>
            {['all', ...STATUSES].map(st => (
              <button key={st} style={{ ...s.chip, ...(statusFilter === st ? s.chipActive : {}) }} onClick={() => setStatusFilter(st)}>
                {st === 'all' ? 'All' : st === 'Under Contract' ? 'Contract' : st}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>{filtered.length} buyer{filtered.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <div style={s.snapshotGrid}>
        {filtered.length === 0 && (
          <div style={s.emptySnapshot}>
            <div style={s.emptyTitle}>No buyers yet</div>
            <div style={s.emptySub}>Add your first buyer to start building the picture.</div>
            <button style={s.primaryBtn} onClick={addBuyer}>+ Add Buyer</button>
          </div>
        )}
        {filtered.map(b => <SnapshotCard key={b.id} buyer={b} onSelect={selectBuyer} onLog={() => { setSelectedId(b.id); openShowing() }} />)}
      </div>
    </div>
  )
}

// ─── SNAPSHOT CARD ────────────────────────────────────────────────────────────
function SnapshotCard({ buyer, onSelect, onLog }) {
  const badge = STATUS_COLORS[buyer.status] || STATUS_COLORS['Active']
  const count = nsComplete(buyer.northStar)
  const summary = nsSummary(buyer.northStar)
  const lastShowing = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
  const needsAttention = count < 3
  const noHypothesis = count === 0

  return (
    <div style={{ ...s.snapshotCard, ...(needsAttention ? s.snapshotCardAlert : {}) }}>
      <div style={s.cardHeader}>
        <div style={s.cardHeaderLeft}>
          <div style={s.cardName}>{buyer.clientName || 'Unnamed Buyer'}</div>
          {buyer.contacts?.[1]?.name && <div style={s.cardSpouse}>& {buyer.contacts[1].name}</div>}
          <div style={s.cardAgent}>{buyer.agentName || 'No agent'}</div>
        </div>
        <span style={{ ...s.statusBadge, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>{buyer.status}</span>
      </div>

      <div style={s.cardBody}>
        <div style={s.cardNsLabel}>NORTH STAR</div>
        {summary ? (
          <div style={s.cardNsSummary}>{summary}</div>
        ) : (
          <div style={s.cardNsEmpty}>Hypothesis not started</div>
        )}
        {lastShowing?.hypothesisUpdate && (
          <div style={s.cardLastUpdate}>
            <span style={s.cardLastUpdateLabel}>Last update: </span>
            {lastShowing.hypothesisUpdate}
          </div>
        )}
      </div>

      <div style={s.cardFooter}>
        <div style={s.cardStats}>
          <span style={s.cardStat}>{buyer.showings.length} showing{buyer.showings.length !== 1 ? 's' : ''}</span>
          {needsAttention && <span style={s.cardAlert}>{noHypothesis ? '⚠ Start North Star' : `⚠ ${count}/6 complete`}</span>}
        </div>
        <div style={s.cardActions}>
          <button style={s.cardLogBtn} onClick={e => { e.stopPropagation(); onLog() }}>+ Log Showing</button>
          <button style={s.cardViewBtn} onClick={() => onSelect(buyer.id, noHypothesis ? 'northstar' : 'northstar')}>
            {noHypothesis ? 'Start →' : 'Open →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── BUYER VIEW ───────────────────────────────────────────────────────────────
function BuyerView({ buyer, agents, currentAgent, saving, tab, setTab, aiSuggestions, aiLoading, setAiSuggestions, updateBuyer, updateNS, updateProfile, applyAISuggestions, saveShowing, deleteShowing, deleteBuyer, openShowing, onBack, mindsetOpen, setMindsetOpen }) {
  const badge = STATUS_COLORS[buyer.status] || STATUS_COLORS['Active']

  return (
    <div style={s.buyerScreen}>
      {/* Header */}
      <div style={s.buyerHeader}>
        <div style={s.buyerHeaderLeft}>
          <button style={s.backBtn} onClick={onBack}>← All Buyers</button>
          <div style={s.buyerName}>{buyer.clientName || 'Unnamed Buyer'}{buyer.contacts?.[1]?.name ? <span style={s.buyerSpouse}> & {buyer.contacts[1].name}</span> : ''}</div>
          <div style={s.buyerMeta}>
            {buyer.agentName || 'No agent'} ·{' '}
            <span style={{ ...s.statusPill, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>{buyer.status}</span>
            {' · '}
            <span style={{ color: saving ? '#f59e0b' : '#c9a84c' }}>{saving ? 'Saving…' : 'Saved'}</span>
          </div>
        </div>
        <div style={s.buyerHeaderRight}>
          <button style={s.logShowingBtn} onClick={() => openShowing()}>+ Log Showing</button>
          <select style={s.statusSelect} value={buyer.status} onChange={e => updateBuyer({ status: e.target.value })}>
            {STATUSES.map(st => <option key={st}>{st}</option>)}
          </select>
          <button style={s.ghostBtn} onClick={() => deleteBuyer(buyer.id)}>Delete</button>
        </div>
      </div>

      {/* AI loading bar */}
      {aiLoading && (
        <div style={s.aiLoadingBar}>
          <div style={s.aiLoadingText}>✦ Analyzing showing debrief to refine the North Star…</div>
        </div>
      )}

      {/* AI suggestions */}
      {aiSuggestions && (
        <AISuggestionPanel
          current={buyer.northStar}
          suggestions={aiSuggestions}
          onApply={applyAISuggestions}
          onDismiss={() => setAiSuggestions(null)}
        />
      )}

      {/* Tabs */}
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

// ─── AI SUGGESTION PANEL ──────────────────────────────────────────────────────
function AISuggestionPanel({ current, suggestions, onApply, onDismiss }) {
  const [edits, setEdits] = useState({ ...suggestions })
  const labels = { propertyType: 'Property Type', location: 'Location', motivation: 'Core Motivation', whatMattersMost: 'What Matters Most', willingToTrade: 'Will Give Up', tradeFor: 'In Exchange For' }
  const changed = Object.keys(suggestions).filter(k => suggestions[k] !== current[k])

  if (changed.length === 0) {
    return (
      <div style={s.aiPanel}>
        <div style={s.aiPanelHeader}>
          <span style={s.aiPanelTitle}>✦ North Star Analysis</span>
          <button style={s.aiDismiss} onClick={onDismiss}>Dismiss</button>
        </div>
        <div style={s.aiNoChange}>The showing confirms the current hypothesis. No changes suggested.</div>
      </div>
    )
  }

  return (
    <div style={s.aiPanel}>
      <div style={s.aiPanelHeader}>
        <span style={s.aiPanelTitle}>✦ North Star refinements suggested</span>
        <button style={s.aiDismiss} onClick={onDismiss}>Dismiss</button>
      </div>
      <div style={s.aiPanelSub}>Based on the showing debrief. Review and apply below.</div>
      <div style={s.aiChanges}>
        {changed.map(k => (
          <div key={k} style={s.aiChange}>
            <div style={s.aiChangeLabel}>{labels[k]}</div>
            <div style={s.aiChangeRow}>
              <div style={s.aiChangeCurrent}>{current[k] || <em>was empty</em>}</div>
              <div style={s.aiChangeArrow}>→</div>
              <input style={s.aiChangeInput} value={edits[k]} onChange={e => setEdits(p => ({ ...p, [k]: e.target.value }))} />
            </div>
          </div>
        ))}
      </div>
      <div style={s.aiPanelActions}>
        <button style={s.aiApplyBtn} onClick={() => onApply({ ...current, ...edits })}>Apply All Changes</button>
        <button style={s.ghostBtn} onClick={onDismiss}>Keep Current</button>
      </div>
    </div>
  )
}

// ─── NORTH STAR TAB ───────────────────────────────────────────────────────────
function NorthStarTab({ buyer, updateNS }) {
  const ns = buyer.northStar
  const count = nsComplete(ns)
  const coachMsg = count === 0 ? 'Start here. What did this buyer tell you in the first conversation?'
    : count < 3 ? 'You\'ve started. Every empty field is an unanswered question — keep going.'
    : count < 6 ? 'Getting clearer. Fill the remaining fields to complete the picture.'
    : 'Hypothesis complete. Update it after every showing.'
  const coachColor = count === 6 ? '#14532d' : count >= 3 ? '#713f12' : '#1e3a5f'
  const coachBg = count === 6 ? '#f0fdf4' : count >= 3 ? '#fef9c3' : '#eff6ff'

  return (
    <div style={s.pane}>
      <div style={{ ...s.coachCard, background: coachBg }}>
        <div style={{ fontSize: 13, color: coachColor, lineHeight: 1.6 }}>{coachMsg}</div>
      </div>
      <div style={s.nsBuckets}>
        <NsBucket title="THE WHAT" sub="Property + location" fields={[
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
      {buyer.showings.find(s => s.hypothesisUpdate) && (
        <div style={s.lastUpdateCard}>
          <div style={s.lastUpdateLabel}>LAST NORTH STAR UPDATE</div>
          <div style={s.lastUpdateText}>{[...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date)).find(s => s.hypothesisUpdate)?.hypothesisUpdate}</div>
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
            <input style={{ ...s.field, ...(ns[f.key] ? s.fieldFilled : {}) }} value={ns[f.key]} placeholder={f.placeholder} onChange={e => updateNS(f.key, e.target.value)} />
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
              {contact.isPrimary ? <span style={s.primaryBadge}>Primary</span> : <button style={s.setPrimaryBtn} onClick={setPrimary}>Set as primary</button>}
            </div>
            <div style={s.contactGrid}>
              <div style={{ gridColumn: '1/-1' }}>
                <FL>Full Name</FL>
                <input style={s.field} value={contact.name} placeholder="Full name" onChange={e => { upd('name', e.target.value); if (contact.isPrimary) updateBuyer({ clientName: e.target.value }) }} />
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
          <option value="">Select agent...</option>
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
      <div style={s.profileNote}>These four inputs build the foundation. They feed into the North Star.</div>
      {[
        { key: 'friction', label: 'The Friction — what are they moving away from?', placeholder: 'What\'s broken or unsustainable in their current situation?' },
        { key: 'gain', label: 'The Gain — what are they moving toward?', placeholder: 'What does success look like for them?' },
        { key: 'nonNegotiables', label: 'Non-Negotiables — what kills a house immediately?', placeholder: 'Hard limits, deal-breakers...' },
        { key: 'patterns', label: 'Patterns — what keeps coming up?', placeholder: 'Recurring themes, consistent reactions...' },
      ].map(f => (
        <div key={f.key} style={{ marginBottom: 18 }}>
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
                  <div style={s.showingDate}>{sh.date ? new Date(sh.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}{sh.agentName ? ` · ${sh.agentName}` : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={s.ghostBtn} onClick={() => openShowing(sh)}>Edit</button>
                  <button style={s.dangerBtn} onClick={() => { if (window.confirm('Delete?')) deleteShowing(sh.id) }}>Delete</button>
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
      <div style={s.refinementsIntro}>This is your team's collective intelligence on this buyer. Every entry is the picture getting sharper.</div>
      {buyer.showings.length === 0 ? (
        <div style={s.emptySub}>Log showings to see the hypothesis evolve here.</div>
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
            <div style={{ paddingLeft: 20, fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>No hypothesis updates yet.</div>
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

// ─── SHOWING FORM ─────────────────────────────────────────────────────────────
function ShowingForm({ draft, setDraft, onSave, onCancel, isEdit }) {
  const upd = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  return (
    <div style={s.formScreen}>
      <div style={s.formTopBar}>
        <button style={s.backBtn} onClick={onCancel}>← Back</button>
        <div style={s.formTitle}>{isEdit ? 'Edit Showing' : 'Log a Showing'}</div>
        <div style={{ width: 80 }} />
      </div>
      <div style={s.formScroll}>
        <div style={s.formBody}>
          <div style={s.coachCard}>
            <div style={s.coachQ}>Did the picture get clearer or fuzzier?</div>
            <div style={s.coachSub}>Your answers should sharpen the North Star — not just record what happened.</div>
          </div>

          <div style={s.twoCol}>
            <div><FL>Date</FL><input type="date" style={s.field} value={draft.date} onChange={e => upd('date', e.target.value)} /></div>
            <div><FL>Logged by</FL><input style={s.field} value={draft.agentName} placeholder="Agent name" onChange={e => upd('agentName', e.target.value)} /></div>
          </div>
          <div><FL>Property Address</FL><input style={s.field} value={draft.address} placeholder="123 Main St" onChange={e => upd('address', e.target.value)} /></div>

          <div style={s.formSection}>
            <div style={s.formSectionLabel}>WHAT WE OBSERVED</div>
            <div><FL>What they responded to — lingered on, got excited about</FL><textarea style={s.textarea} value={draft.respondedTo} placeholder="Features, rooms, moments that created energy..." onChange={e => upd('respondedTo', e.target.value)} /></div>
            <div><FL>What they pulled back from — dismissed or hesitated on</FL><textarea style={s.textarea} value={draft.pulledBackFrom} placeholder="What they brushed past, questioned, or rejected..." onChange={e => upd('pulledBackFrom', e.target.value)} /></div>
          </div>

          <div style={s.formSection}>
            <div style={s.formSectionLabel}>WHAT WE LEARNED</div>
            <div><FL>What became more true about the hypothesis</FL><textarea style={s.textarea} value={draft.moreTrue} placeholder="Evidence that confirmed what we believed..." onChange={e => upd('moreTrue', e.target.value)} /></div>
            <div><FL>What became less true about the hypothesis</FL><textarea style={s.textarea} value={draft.lessTrue} placeholder="Evidence that challenged what we believed..." onChange={e => upd('lessTrue', e.target.value)} /></div>
          </div>

          <div style={s.formSection}>
            <div style={s.formSectionLabel}>HOW THE NORTH STAR CHANGES</div>
            <div style={s.nsHint}>Most important field. The AI will use this — along with your observations — to suggest specific updates to the North Star.</div>
            <textarea style={{ ...s.textarea, borderColor: '#c9a84c', minHeight: 100 }} value={draft.hypothesisUpdate} placeholder="Based on this showing, our hypothesis now says..." onChange={e => upd('hypothesisUpdate', e.target.value)} />
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
  // Layout
  screen: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#faf7f2', fontFamily: "Georgia, 'Times New Roman', serif", overflow: 'hidden' },
  buyerScreen: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#faf7f2', fontFamily: "Georgia, 'Times New Roman', serif", overflow: 'hidden' },
  formScreen: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#faf7f2', fontFamily: "Georgia, 'Times New Roman', serif", overflow: 'hidden' },
  loadingScreen: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Georgia, serif', color: '#94a3b8', fontSize: 14 },

  // Snapshot header
  snapshotHeader: { background: '#0f1729', flexShrink: 0 },
  snapshotTopRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px 10px' },
  brand: { fontSize: 10, letterSpacing: '0.22em', color: '#c9a84c', fontWeight: 'bold', marginBottom: 2 },
  brandSub: { fontSize: 11, color: '#475569' },
  snapshotHeaderRight: { display: 'flex', alignItems: 'center', gap: 12 },
  agentName: { fontSize: 12, color: '#64748b' },
  mindsetNavBtn: { padding: '6px 12px', border: '1px solid #1e2d4a', borderRadius: 4, background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  addBuyerBtn: { padding: '7px 16px', border: 'none', borderRadius: 4, background: '#c9a84c', color: '#0f1729', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  signOutBtn: { fontSize: 11, color: '#475569', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Mindset drawer
  mindsetDrawer: { background: '#1e2d4a', padding: '16px 24px 12px', borderTop: '1px solid #1e2d4a' },
  mindsetGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px 20px', marginBottom: 12 },
  mindsetItem: {},
  mindsetTitle: { fontSize: 12, fontWeight: 'bold', color: '#c9a84c', marginBottom: 4 },
  mindsetBody: { fontSize: 12, color: '#94a3b8', lineHeight: 1.6 },
  closeMindset: { padding: '5px 14px', border: '1px solid #334155', borderRadius: 4, background: 'transparent', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Filter bar
  filterBar: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 24px 12px', flexWrap: 'wrap' },
  searchInput: { padding: '7px 12px', border: '1px solid #1e2d4a', borderRadius: 5, background: '#1e2d4a', fontSize: 13, fontFamily: 'Georgia, serif', color: '#f1f5f9', outline: 'none', width: 180 },
  filterDivider: { width: 1, height: 20, background: '#1e2d4a' },
  filterLabel: { fontSize: 10, letterSpacing: '0.14em', color: '#475569', fontWeight: 'bold' },
  agentSelect: { padding: '6px 10px', border: '1px solid #1e2d4a', borderRadius: 4, background: '#1e2d4a', fontSize: 12, fontFamily: 'Georgia, serif', color: '#94a3b8', cursor: 'pointer' },
  statusChips: { display: 'flex', gap: 6 },
  chip: { padding: '5px 11px', fontSize: 12, borderRadius: 4, border: '1px solid #1e2d4a', background: 'transparent', cursor: 'pointer', color: '#64748b', fontFamily: 'Georgia, serif' },
  chipActive: { background: '#c9a84c', color: '#0f1729', borderColor: '#c9a84c', fontWeight: 'bold' },

  // Snapshot grid
  snapshotGrid: { flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, alignContent: 'start' },

  // Snapshot cards
  snapshotCard: { background: '#fff', border: '1px solid #e8e0d4', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(15,23,41,0.06)' },
  snapshotCardAlert: { borderColor: '#fca5a5' },
  cardHeader: { background: '#0f1729', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardHeaderLeft: {},
  cardName: { fontSize: 15, color: '#f1f5f9', fontWeight: 'bold', marginBottom: 2 },
  cardSpouse: { fontSize: 12, color: '#475569', marginBottom: 2 },
  cardAgent: { fontSize: 11, color: '#475569' },
  statusBadge: { fontSize: 10, padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap', marginTop: 2 },
  cardBody: { padding: '14px 16px' },
  cardNsLabel: { fontSize: 9, letterSpacing: '0.16em', color: '#c9a84c', fontWeight: 'bold', marginBottom: 6 },
  cardNsSummary: { fontSize: 14, color: '#1f2937', lineHeight: 1.6, marginBottom: 8 },
  cardNsEmpty: { fontSize: 13, color: '#9ca3af', fontStyle: 'italic', marginBottom: 8 },
  cardLastUpdate: { fontSize: 12, color: '#6b7280', background: '#faf7f2', borderRadius: 4, padding: '6px 10px', lineHeight: 1.5 },
  cardLastUpdateLabel: { fontWeight: 'bold', color: '#c9a84c' },
  cardFooter: { padding: '0 16px 14px' },
  cardStats: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardStat: { fontSize: 11, color: '#9ca3af' },
  cardAlert: { fontSize: 11, color: '#dc2626', fontWeight: 'bold' },
  cardActions: { display: 'flex', gap: 8 },
  cardLogBtn: { flex: 1, padding: '8px', background: '#0f1729', color: '#c9a84c', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  cardViewBtn: { padding: '8px 14px', background: '#faf7f2', color: '#374151', border: '1px solid #e8e0d4', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Buyer header
  buyerHeader: { background: '#0f1729', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 },
  buyerHeaderLeft: {},
  backBtn: { fontSize: 12, color: '#c9a84c', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif', padding: 0, marginBottom: 6, display: 'block' },
  buyerName: { fontSize: 22, fontWeight: 'bold', color: '#f1f5f9', marginBottom: 4 },
  buyerSpouse: { fontSize: 16, color: '#64748b', fontWeight: 'normal' },
  buyerMeta: { fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  statusPill: { fontSize: 10, padding: '2px 7px', borderRadius: 4 },
  buyerHeaderRight: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 },
  logShowingBtn: { padding: '8px 16px', border: 'none', borderRadius: 5, background: '#c9a84c', color: '#0f1729', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  statusSelect: { padding: '7px 10px', borderRadius: 4, border: '1px solid #1e2d4a', background: '#1e2d4a', fontSize: 12, fontFamily: 'Georgia, serif', cursor: 'pointer', color: '#94a3b8' },

  // AI panel
  aiLoadingBar: { background: '#1e2d4a', padding: '10px 24px', flexShrink: 0 },
  aiLoadingText: { fontSize: 12, color: '#c9a84c', fontStyle: 'italic' },
  aiPanel: { background: '#fff', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', margin: '0', padding: '16px 24px', flexShrink: 0 },
  aiPanelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  aiPanelTitle: { fontSize: 13, color: '#0f1729', fontWeight: 'bold', letterSpacing: '0.04em' },
  aiDismiss: { fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  aiPanelSub: { fontSize: 12, color: '#6b7280', marginBottom: 14 },
  aiNoChange: { fontSize: 13, color: '#16a34a', fontStyle: 'italic' },
  aiChanges: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 },
  aiChange: {},
  aiChangeLabel: { fontSize: 10, letterSpacing: '0.08em', color: '#9ca3af', textTransform: 'uppercase', marginBottom: 4 },
  aiChangeRow: { display: 'flex', alignItems: 'center', gap: 10 },
  aiChangeCurrent: { fontSize: 13, color: '#9ca3af', minWidth: 140, fontStyle: 'italic' },
  aiChangeArrow: { fontSize: 14, color: '#c9a84c', flexShrink: 0 },
  aiChangeInput: { flex: 1, padding: '7px 10px', border: '1px solid #c9a84c', borderRadius: 4, fontSize: 13, fontFamily: 'Georgia, serif', color: '#0f1729', background: '#faf7f2', outline: 'none' },
  aiPanelActions: { display: 'flex', gap: 10 },
  aiApplyBtn: { padding: '8px 18px', border: 'none', borderRadius: 5, background: '#0f1729', color: '#c9a84c', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },

  // Tabs
  tabBar: { display: 'flex', borderBottom: '1px solid #e8e0d4', flexShrink: 0, background: '#fff', overflowX: 'auto' },
  tab: { padding: '11px 18px', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontSize: 13, cursor: 'pointer', color: '#9ca3af', fontFamily: 'Georgia, serif', marginBottom: -1, whiteSpace: 'nowrap' },
  tabActive: { color: '#0f1729', borderBottomColor: '#c9a84c', fontWeight: 'bold' },
  tabContent: { flex: 1, overflowY: 'auto', padding: '24px' },
  pane: { maxWidth: 860 },

  // North Star
  coachCard: { borderRadius: 6, padding: '12px 16px', marginBottom: 20 },
  nsBuckets: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 20 },
  nsBucket: { border: '1px solid #e8e0d4', borderRadius: 8, overflow: 'hidden', background: '#fff' },
  nsBucketHead: { background: '#0f1729', padding: '10px 14px' },
  nsBucketTitle: { fontSize: 9, letterSpacing: '0.18em', color: '#c9a84c', fontWeight: 'bold' },
  nsBucketSub: { fontSize: 10, color: '#475569', marginTop: 2 },
  nsBucketBody: { padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 },
  lastUpdateCard: { background: '#fff', border: '1px solid #e8e0d4', borderLeft: '3px solid #c9a84c', borderRadius: 6, padding: '12px 16px' },
  lastUpdateLabel: { fontSize: 9, letterSpacing: '0.14em', color: '#c9a84c', fontWeight: 'bold', marginBottom: 6 },
  lastUpdateText: { fontSize: 14, color: '#1f2937', lineHeight: 1.6 },

  // Profile
  profileNote: { fontSize: 13, color: '#6b7280', fontStyle: 'italic', marginBottom: 20, padding: '10px 14px', background: '#fff', borderRadius: 6, border: '1px solid #e8e0d4' },

  // Contacts
  contactCard: { border: '1px solid #e8e0d4', borderRadius: 8, padding: '16px', marginBottom: 14, background: '#fff' },
  contactCardPrimary: { borderColor: '#c9a84c', background: '#faf7f2' },
  contactCardTop: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  roleInput: { fontSize: 11, fontWeight: 'bold', letterSpacing: '0.08em', color: '#6b7280', background: 'transparent', border: 'none', borderBottom: '1px dashed #d1d5db', outline: 'none', padding: '2px 4px', fontFamily: 'Georgia, serif', textTransform: 'uppercase', width: 160 },
  primaryBadge: { fontSize: 10, background: '#0f1729', color: '#c9a84c', padding: '2px 8px', borderRadius: 10 },
  setPrimaryBtn: { fontSize: 10, background: 'none', border: '1px solid #e8e0d4', borderRadius: 10, color: '#9ca3af', padding: '2px 8px', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  contactGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' },

  // Forms
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginBottom: 14 },
  fieldLabel: { fontSize: 11, letterSpacing: '0.06em', color: '#6b7280', textTransform: 'uppercase', marginBottom: 5 },
  field: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e8e0d4', borderRadius: 6, background: '#fff', fontSize: 14, fontFamily: 'Georgia, serif', color: '#0f1729', outline: 'none' },
  fieldFilled: { background: '#faf7f2', borderColor: '#c9a84c', color: '#0f1729' },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e8e0d4', borderRadius: 6, background: '#fff', fontSize: 14, fontFamily: 'Georgia, serif', color: '#0f1729', outline: 'none', resize: 'vertical', minHeight: 90, lineHeight: 1.6 },

  // Showings
  showingCard: { background: '#fff', border: '1px solid #e8e0d4', borderRadius: 8, padding: '16px', marginBottom: 14 },
  showingCardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  showingAddr: { fontSize: 15, fontWeight: 'bold', color: '#0f1729' },
  showingDate: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  nsUpdateBlock: { background: '#faf7f2', border: '1px solid #e8e0d4', borderLeft: '3px solid #c9a84c', borderRadius: 4, padding: '10px 12px', marginBottom: 10 },
  nsUpdateLabel: { fontSize: 9, letterSpacing: '0.12em', color: '#c9a84c', fontWeight: 'bold', marginBottom: 4 },
  nsUpdateText: { fontSize: 13, color: '#1f2937', lineHeight: 1.5 },
  showingDebrief: { fontSize: 13, color: '#4b5563', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 4 },
  debriefKey: { fontWeight: 'bold', color: '#374151' },

  // Refinements
  refinementsIntro: { fontSize: 14, color: '#6b7280', fontStyle: 'italic', marginBottom: 24, padding: '12px 16px', background: '#fff', borderRadius: 6, border: '1px solid #e8e0d4', lineHeight: 1.6 },
  timeline: { borderLeft: '2px solid #e8e0d4', paddingLeft: 22, marginLeft: 6 },
  timelineItem: { position: 'relative', paddingBottom: 22, display: 'flex', gap: 14 },
  timelineDot: { width: 10, height: 10, borderRadius: '50%', background: '#c9a84c', flexShrink: 0, marginTop: 3, marginLeft: -26 },
  timelineLabel: { fontSize: 11, color: '#9ca3af', marginBottom: 4 },
  timelineText: { fontSize: 14, color: '#0f1729', lineHeight: 1.6 },

  // Showing form
  formTopBar: { background: '#0f1729', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', flexShrink: 0 },
  formTitle: { fontSize: 14, color: '#f1f5f9', fontWeight: 'bold' },
  formScroll: { flex: 1, overflowY: 'auto' },
  formBody: { padding: '24px', maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 },
  coachQ: { fontSize: 16, color: '#0f1729', fontWeight: 'bold', marginBottom: 4 },
  coachSub: { fontSize: 13, color: '#6b7280', lineHeight: 1.5 },
  formSection: { display: 'flex', flexDirection: 'column', gap: 14 },
  formSectionLabel: { fontSize: 10, letterSpacing: '0.16em', color: '#9ca3af', fontWeight: 'bold', paddingBottom: 6, borderBottom: '1px solid #e8e0d4' },
  nsHint: { fontSize: 12, color: '#c9a84c', fontStyle: 'italic', marginBottom: 8 },
  saveShowingBtn: { width: '100%', padding: '14px', border: 'none', borderRadius: 8, background: '#0f1729', color: '#c9a84c', fontSize: 16, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold', marginTop: 8 },

  // Buttons
  primaryBtn: { padding: '9px 20px', border: 'none', borderRadius: 5, background: '#0f1729', color: '#c9a84c', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  ghostBtn: { padding: '7px 14px', borderRadius: 5, border: '1px solid #e8e0d4', background: '#fff', color: '#6b7280', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  dangerBtn: { padding: '7px 14px', borderRadius: 5, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Empty states
  emptySnapshot: { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: '#0f1729', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#9ca3af', marginBottom: 20, lineHeight: 1.6 },
}
