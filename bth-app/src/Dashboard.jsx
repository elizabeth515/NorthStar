import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

// ─── HELPERS ─────────────────────────────────────────────────────────────────
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
    propertyAddress: row.property_address || '',
    northStar: { ...DEFAULT_NS, ...(row.north_star || {}) },
    profile: { ...DEFAULT_PROFILE, ...(row.profile || {}) },
    showings: row.showings || [],
    intakeDate: row.intake_date || '',
    targetMoveDate: row.target_move_date || '',
    preApprovalStatus: row.pre_approval_status || '',
    preApprovalAmount: row.pre_approval_amount || '',
    lender: row.lender || '',
    referralSource: row.referral_source || '',
    createdAt: row.created_at,
  }
}

function buyerToDb(b) {
  return {
    client_name: b.clientName, agent_name: b.agentName, status: b.status,
    contacts: b.contacts, property_address: b.propertyAddress,
    north_star: b.northStar, profile: b.profile, showings: b.showings,
    intake_date: b.intakeDate, target_move_date: b.targetMoveDate,
    pre_approval_status: b.preApprovalStatus, pre_approval_amount: b.preApprovalAmount,
    lender: b.lender, referral_source: b.referralSource,
    updated_at: new Date().toISOString(),
  }
}

function newBuyerObj(agentName = '') {
  return {
    clientName: '', agentName, status: 'Active',
    contacts: DEFAULT_CONTACTS.map(c => ({ ...c })),
    propertyAddress: '', northStar: { ...DEFAULT_NS },
    profile: { ...DEFAULT_PROFILE }, showings: [],
    intakeDate: new Date().toISOString().split('T')[0],
    targetMoveDate: '', preApprovalStatus: '', preApprovalAmount: '',
    lender: '', referralSource: '',
  }
}

function newShowing() {
  return {
    id: Date.now().toString(),
    date: new Date().toISOString().split('T')[0],
    address: '', respondedTo: '', pulledBackFrom: '',
    moreTrue: '', lessTrue: '', hypothesisUpdate: '',
  }
}

function nsComplete(ns) {
  return [ns.propertyType, ns.location, ns.motivation, ns.whatMattersMost, ns.willingToTrade, ns.tradeFor].filter(Boolean).length
}

function formatPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 10)
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
}

const STATUSES = ['Active', 'Under Contract', 'Closed', 'On Hold']
const PRE_APPROVAL = ['Not started', 'In progress', 'Approved', 'Not applicable']
const STATUS_BADGE = {
  'Active':         { bg: '#eef6e8', color: '#3a6a2a', border: '#b0c8a0' },
  'Under Contract': { bg: '#e8f0f8', color: '#2a4a7a', border: '#a0b8d8' },
  'Closed':         { bg: '#edeae5', color: '#5a5550', border: '#c8c4bc' },
  'On Hold':        { bg: '#fef3e2', color: '#7a4f10', border: '#e0c080' },
}

const MINDSET = [
  { title: 'Destroy Ambiguity', body: 'Everything starts unclear. Your job is to reduce uncertainty until the picture becomes clear. Every conversation and showing should create clarity. If the picture is still fuzzy, keep digging.' },
  { title: 'Find the Best Answer', body: 'The first answer is rarely the best answer. Buyers tell you what they think they want. Experts identify what actually matters. You are hired to find the best answer — not collect them.' },
  { title: '01 — Build', body: 'After the first conversation, complete the North Star. Listen for friction, gain, non-negotiables, and patterns.' },
  { title: '02 — Test', body: 'Every showing is research. Watch what they linger on, dismiss, get excited about, or hesitate on.' },
  { title: '03 — Refine', body: 'Expert agents don\'t defend their first hypothesis. They improve it. The goal is clarity, not confirmation.' },
]

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function Dashboard({ session }) {
  const [buyers, setBuyers] = useState([])
  const [agents, setAgents] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [tab, setTab] = useState('contacts')
  const [showingForm, setShowingForm] = useState(false)
  const [showingDraft, setShowingDraft] = useState(null)
  const [editingShowing, setEditingShowing] = useState(null)
  const [nsExpanded, setNsExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mindsetOpen, setMindsetOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
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
    const loaded = (bRows || []).map(dbToBuyer)
    setBuyers(loaded)
    setAgents(aRows || [])
    if (loaded.length) setSelectedId(loaded[0].id)
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
    }, 900)
  }, [])

  const addBuyer = async () => {
    const agentName = agents[0]?.name || ''
    const { data, error } = await supabase.from('buyers').insert(buyerToDb(newBuyerObj(agentName))).select().single()
    if (!error && data) {
      const b = dbToBuyer(data)
      setBuyers(p => [b, ...p])
      setSelectedId(b.id)
      setTab('contacts')
      setNsExpanded(true)
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
      const showings = exists ? b.showings.map(s => s.id === showing.id ? showing : s) : [...b.showings, showing]
      const nb = { ...b, showings }
      debouncedSave(nb)
      return nb
    }))
    setShowingForm(false)
    setShowingDraft(null)
    setEditingShowing(null)
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
    await supabase.from('buyers').delete().eq('id', id)
    setBuyers(p => { const u = p.filter(b => b.id !== id); setSelectedId(u.length ? u[0].id : null); return u })
  }

  const openNewShowing = () => { setShowingDraft(newShowing()); setEditingShowing(null); setShowingForm(true); setTab('showings') }
  const openEditShowing = (s) => { setShowingDraft({ ...s }); setEditingShowing(s.id); setShowingForm(true); setTab('showings') }

  const selected = buyers.find(b => b.id === selectedId)
  const currentAgent = agents.find(a => a.id === session.user.id)

  const filtered = buyers
    .filter(b => {
      const matchSearch = b.clientName.toLowerCase().includes(search.toLowerCase()) ||
        b.agentName.toLowerCase().includes(search.toLowerCase()) ||
        (b.contacts?.[0]?.name || '').toLowerCase().includes(search.toLowerCase())
      const matchAgent = agentFilter === 'all' || b.agentName === agentFilter
      const matchStatus = statusFilter === 'all' || b.status === statusFilter
      return matchSearch && matchAgent && matchStatus
    })
    .sort((a, b) => {
      if (sortBy === 'name') return (a.clientName || '').localeCompare(b.clientName || '')
      if (sortBy === 'newest') return new Date(b.createdAt) - new Date(a.createdAt)
      if (sortBy === 'move') return new Date(a.targetMoveDate || '9999') - new Date(b.targetMoveDate || '9999')
      return 0
    })

  if (loading) return <div style={s.center}>Loading...</div>

  return (
    <div style={s.shell}>
      {/* ── SIDEBAR ── */}
      <aside style={s.sidebar}>
        <div style={s.sidebarTop}>
          <div style={s.brandMark}>BUILD THE HOUSE</div>
          <div style={s.brandSub}>Buyer Framework</div>
          <div style={s.userRow}>
            <span style={s.userName}>{currentAgent?.name || session.user.email}</span>
            <button style={s.signOutBtn} onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>

        <button style={s.mindsetToggle} onClick={() => setMindsetOpen(o => !o)}>
          <span>MINDSET</span><span style={s.toggleArrow}>{mindsetOpen ? '▲' : '▼'}</span>
        </button>
        {mindsetOpen && (
          <div style={s.mindsetPanel}>
            {MINDSET.map(m => (
              <div key={m.title} style={s.mindsetItem}>
                <div style={s.mindsetTitle}>{m.title}</div>
                <div style={s.mindsetBody}>{m.body}</div>
              </div>
            ))}
          </div>
        )}

        <div style={s.divider} />

        {/* Search + add */}
        <div style={s.buyerHeader}>
          <input style={s.search} placeholder="Search buyers..." value={search} onChange={e => setSearch(e.target.value)} />
          <button style={s.addBtn} onClick={addBuyer} title="Add buyer">+</button>
        </div>

        {/* Filter bar */}
        <div style={s.filterBar}>
          <button style={s.filterToggle} onClick={() => setFiltersOpen(o => !o)}>
            <span>Filter &amp; Sort</span>
            <span style={s.toggleArrow}>{filtersOpen ? '▲' : '▼'}</span>
          </button>
          {filtersOpen && (
            <div style={s.filterPanel}>
              <div style={s.filterRow}>
                <div style={s.filterLabel}>AGENT</div>
                <select style={s.filterSelect} value={agentFilter} onChange={e => setAgentFilter(e.target.value)}>
                  <option value="all">All agents</option>
                  {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                </select>
              </div>
              <div style={s.filterRow}>
                <div style={s.filterLabel}>STATUS</div>
                <div style={s.statusChips}>
                  {['all', ...STATUSES].map(st => (
                    <button key={st} style={{ ...s.chip, ...(statusFilter === st ? s.chipActive : {}) }} onClick={() => setStatusFilter(st)}>
                      {st === 'all' ? 'All' : st === 'Under Contract' ? 'Contract' : st}
                    </button>
                  ))}
                </div>
              </div>
              <div style={s.filterRow}>
                <div style={s.filterLabel}>SORT</div>
                <select style={s.filterSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  <option value="name">Name A–Z</option>
                  <option value="newest">Newest first</option>
                  <option value="move">Target move date</option>
                </select>
              </div>
              {(agentFilter !== 'all' || statusFilter !== 'all') && (
                <button style={s.clearFilters} onClick={() => { setAgentFilter('all'); setStatusFilter('all') }}>Clear filters</button>
              )}
            </div>
          )}
        </div>

        {/* Buyer count */}
        <div style={s.buyerCount}>{filtered.length} buyer{filtered.length !== 1 ? 's' : ''}</div>

        {/* Buyer list */}
        <div style={s.buyerList}>
          {filtered.length === 0 && <div style={s.emptyList}>No buyers match.</div>}
          {filtered.map(b => {
            const isActive = b.id === selectedId
            const badge = STATUS_BADGE[b.status] || STATUS_BADGE['Active']
            return (
              <div key={b.id} style={{ ...s.buyerItem, ...(isActive ? s.buyerItemActive : {}) }}
                onClick={() => { setSelectedId(b.id); setTab('contacts'); setShowingForm(false) }}>
                <div style={s.buyerName}>{b.clientName || 'Unnamed Buyer'}</div>
                {b.contacts?.[1]?.name && <div style={s.buyerSpouse}>& {b.contacts[1].name}</div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <div style={s.buyerAgent}>{b.agentName || 'No agent'}</div>
                  <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>{b.status}</span>
                </div>
              </div>
            )
          })}
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main style={s.main}>
        {!selected ? (
          <div style={s.center}>
            <div style={{ textAlign: 'center' }}>
              <div style={s.emptyTitle}>Build the House</div>
              <div style={s.emptySub}>Add a buyer to get started.</div>
              <button style={s.primaryBtn} onClick={addBuyer}>+ Add buyer</button>
            </div>
          </div>
        ) : (
          <>
            {/* ── HEADER ── */}
            <div style={s.header}>
              <div>
                <div style={s.headerName}>
                  {selected.clientName || 'Unnamed Buyer'}
                  {selected.contacts?.[1]?.name && <span style={s.headerSpouse}> & {selected.contacts[1].name}</span>}
                </div>
                <div style={s.headerMeta}>
                  {selected.agentName || 'No agent'} · {selected.showings.length} showing{selected.showings.length !== 1 ? 's' : ''} ·{' '}
                  <span style={{ color: saving ? '#c4813a' : '#4a6e3a' }}>{saving ? 'Saving…' : 'Saved'}</span>
                </div>
              </div>
              <div style={s.headerRight}>
                <select style={s.statusSelect} value={selected.status} onChange={e => updateBuyer({ status: e.target.value })}>
                  {STATUSES.map(st => <option key={st}>{st}</option>)}
                </select>
                <button style={s.ghostBtn} onClick={() => { if (window.confirm('Delete this buyer?')) deleteBuyer(selected.id) }}>Delete</button>
              </div>
            </div>

            {/* ── NORTH STAR ── */}
            <NorthStar buyer={selected} updateNS={updateNS} nsExpanded={nsExpanded} setNsExpanded={setNsExpanded} />

            {/* ── ACTION BUTTONS ── */}
            <div style={s.actionBar}>
              <button style={s.actionBtn} onClick={() => setNsExpanded(o => !o)}>✎ Update North Star</button>
              <button style={s.actionBtnPrimary} onClick={openNewShowing}>+ Log Showing</button>
            </div>

            {/* ── TABS ── */}
            <div style={s.tabBar}>
              {[['contacts','Contacts'],['details','Details'],['financials','Financials'],['profile','Profile'],['showings','Showings'],['refinements','Refinements']].map(([k,l]) => (
                <button key={k} style={{ ...s.tab, ...(tab === k ? s.tabActive : {}) }} onClick={() => { setTab(k); setShowingForm(false) }}>{l}</button>
              ))}
            </div>

            <div style={s.tabContent}>
              {tab === 'contacts'     && <ContactsTab buyer={selected} updateBuyer={updateBuyer} />}
              {tab === 'details'      && <DetailsTab buyer={selected} updateBuyer={updateBuyer} agents={agents} />}
              {tab === 'financials'   && <FinancialsTab buyer={selected} updateBuyer={updateBuyer} />}
              {tab === 'profile'      && <ProfileTab buyer={selected} updateProfile={updateProfile} />}
              {tab === 'showings'     && <ShowingsTab buyer={selected} showingForm={showingForm} setShowingForm={setShowingForm} showingDraft={showingDraft} setShowingDraft={setShowingDraft} editingShowing={editingShowing} saveShowing={saveShowing} deleteShowing={deleteShowing} openEditShowing={openEditShowing} />}
              {tab === 'refinements'  && <RefinementsTab buyer={selected} />}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ─── NORTH STAR ───────────────────────────────────────────────────────────────
function NorthStar({ buyer, updateNS, nsExpanded, setNsExpanded }) {
  const ns = buyer.northStar
  const count = nsComplete(ns)
  const pct = Math.round((count / 6) * 100)

  return (
    <div style={s.nsPinned}>
      <div style={s.nsTopRow}>
        <div style={s.nsLabelRow}>
          <span style={s.nsLabel}>NORTH STAR HYPOTHESIS</span>
          <div style={s.nsBar}><div style={{ ...s.nsBarFill, width: `${pct}%` }} /></div>
          <span style={s.nsCount}>{count}/6</span>
        </div>
        <button style={s.nsEditBtn} onClick={() => setNsExpanded(o => !o)}>
          {nsExpanded ? 'Collapse' : 'Edit'}
        </button>
      </div>

      {/* Collapsed chip view */}
      {!nsExpanded && (
        <div style={s.nsChips} onClick={() => setNsExpanded(true)}>
          {[
            { val: ns.propertyType && ns.location ? `${ns.propertyType} · ${ns.location}` : null, empty: 'Buyer not set' },
            { val: ns.motivation || null, empty: 'Why not set' },
            { val: ns.whatMattersMost || null, empty: 'Priority not set' },
            { val: ns.willingToTrade && ns.tradeFor ? `Trade: ${ns.willingToTrade} → ${ns.tradeFor}` : null, empty: 'Trade not set' },
          ].map((item, i) => (
            <span key={i} style={item.val ? s.nsChipFilled : s.nsChipEmpty}>{item.val || item.empty}</span>
          ))}
        </div>
      )}

      {/* Expanded bucket view */}
      {nsExpanded && (
        <div style={s.nsBuckets}>
          {/* THE BUYER */}
          <div style={s.nsBucket}>
            <div style={s.nsBucketHeader}>
              <div style={s.nsBucketTitle}>THE BUYER</div>
              <div style={s.nsBucketSub}>What + where</div>
            </div>
            <div style={s.nsBucketBody}>
              <div>
                <FL>Property Type</FL>
                <input style={s.nsField} value={ns.propertyType} placeholder="e.g. single family home" onChange={e => updateNS('propertyType', e.target.value)} />
              </div>
              <div>
                <FL>Location</FL>
                <input style={s.nsField} value={ns.location} placeholder="e.g. Green Hills" onChange={e => updateNS('location', e.target.value)} />
              </div>
            </div>
          </div>

          {/* THE WHY */}
          <div style={s.nsBucket}>
            <div style={s.nsBucketHeader}>
              <div style={s.nsBucketTitle}>THE WHY</div>
              <div style={s.nsBucketSub}>Motivation + priority</div>
            </div>
            <div style={s.nsBucketBody}>
              <div>
                <FL>Core Motivation</FL>
                <input style={s.nsField} value={ns.motivation} placeholder="e.g. upsize for growing family" onChange={e => updateNS('motivation', e.target.value)} />
              </div>
              <div>
                <FL>What Matters Most</FL>
                <input style={s.nsField} value={ns.whatMattersMost} placeholder="e.g. school district" onChange={e => updateNS('whatMattersMost', e.target.value)} />
              </div>
            </div>
          </div>

          {/* THE TRADE */}
          <div style={s.nsBucket}>
            <div style={s.nsBucketHeader}>
              <div style={s.nsBucketTitle}>THE TRADE</div>
              <div style={s.nsBucketSub}>Give up + gain</div>
            </div>
            <div style={s.nsBucketBody}>
              <div>
                <FL>Will Give Up</FL>
                <input style={s.nsField} value={ns.willingToTrade} placeholder="e.g. proximity to work" onChange={e => updateNS('willingToTrade', e.target.value)} />
              </div>
              <div>
                <FL>In Exchange For</FL>
                <input style={s.nsField} value={ns.tradeFor} placeholder="e.g. space and yard" onChange={e => updateNS('tradeFor', e.target.value)} />
              </div>
            </div>
          </div>
        </div>
      )}
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
              {contact.isPrimary
                ? <span style={s.primaryBadge}>Primary</span>
                : <button style={s.setPrimaryBtn} onClick={setPrimary}>Set as primary</button>}
            </div>
            <div style={s.contactGrid}>
              <div style={{ gridColumn: '1 / -1' }}>
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
    </div>
  )
}

// ─── DETAILS TAB ─────────────────────────────────────────────────────────────
function DetailsTab({ buyer, updateBuyer, agents }) {
  return (
    <div style={s.pane}>
      <div style={s.formGrid}>
        <div>
          <FL>Assigned Agent</FL>
          <select style={s.field} value={buyer.agentName} onChange={e => updateBuyer({ agentName: e.target.value })}>
            <option value="">Select agent...</option>
            {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <FL>Status</FL>
          <select style={s.field} value={buyer.status} onChange={e => updateBuyer({ status: e.target.value })}>
            {STATUSES.map(st => <option key={st}>{st}</option>)}
          </select>
        </div>
        <div>
          <FL>Intake Date</FL>
          <input type="date" style={s.field} value={buyer.intakeDate} onChange={e => updateBuyer({ intakeDate: e.target.value })} />
        </div>
        <div>
          <FL>Target Move Date</FL>
          <input type="date" style={s.field} value={buyer.targetMoveDate} onChange={e => updateBuyer({ targetMoveDate: e.target.value })} />
        </div>
        <div>
          <FL>Referral Source</FL>
          <input style={s.field} value={buyer.referralSource} placeholder="e.g. Past client, Zillow..." onChange={e => updateBuyer({ referralSource: e.target.value })} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <FL>Property Address (if known)</FL>
          <AddressAutocomplete value={buyer.propertyAddress || ''} onChange={v => updateBuyer({ propertyAddress: v })} />
        </div>
      </div>
    </div>
  )
}

// ─── FINANCIALS TAB ───────────────────────────────────────────────────────────
function FinancialsTab({ buyer, updateBuyer }) {
  return (
    <div style={s.pane}>
      <div style={s.formGrid}>
        <div>
          <FL>Pre-Approval Status</FL>
          <select style={s.field} value={buyer.preApprovalStatus} onChange={e => updateBuyer({ preApprovalStatus: e.target.value })}>
            <option value="">Select...</option>
            {PRE_APPROVAL.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <FL>Pre-Approval Amount</FL>
          <input style={s.field} value={buyer.preApprovalAmount} placeholder="$000,000" onChange={e => updateBuyer({ preApprovalAmount: e.target.value })} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <FL>Lender / Loan Officer</FL>
          <input style={s.field} value={buyer.lender} placeholder="Name and contact" onChange={e => updateBuyer({ lender: e.target.value })} />
        </div>
      </div>
    </div>
  )
}

// ─── PROFILE TAB ─────────────────────────────────────────────────────────────
function ProfileTab({ buyer, updateProfile }) {
  return (
    <div style={s.pane}>
      <div style={s.profileNote}>These inform the North Star. Build the clearest picture possible.</div>
      <div style={s.formGrid}>
        <div>
          <FL>The Friction — what are they moving away from?</FL>
          <textarea style={s.textarea} value={buyer.profile.friction} placeholder="What's broken or unsustainable?" onChange={e => updateProfile('friction', e.target.value)} />
        </div>
        <div>
          <FL>The Gain — what are they moving toward?</FL>
          <textarea style={s.textarea} value={buyer.profile.gain} placeholder="What does success look like?" onChange={e => updateProfile('gain', e.target.value)} />
        </div>
        <div>
          <FL>Non-Negotiables</FL>
          <textarea style={s.textarea} value={buyer.profile.nonNegotiables} placeholder="Hard limits, deal-breakers..." onChange={e => updateProfile('nonNegotiables', e.target.value)} />
        </div>
        <div>
          <FL>Patterns — what keeps coming up?</FL>
          <textarea style={s.textarea} value={buyer.profile.patterns} placeholder="Recurring themes, consistent reactions..." onChange={e => updateProfile('patterns', e.target.value)} />
        </div>
      </div>
    </div>
  )
}

// ─── SHOWINGS TAB ─────────────────────────────────────────────────────────────
function ShowingsTab({ buyer, showingForm, setShowingForm, showingDraft, setShowingDraft, editingShowing, saveShowing, deleteShowing, openEditShowing }) {
  const upd = (k, v) => setShowingDraft(d => ({ ...d, [k]: v }))
  const sorted = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date))

  if (showingForm && showingDraft) {
    return (
      <div style={s.pane}>
        <div style={s.showingFormHeader}>
          <span style={s.sectionLabel}>{editingShowing ? 'Edit Showing' : 'Log a Showing'}</span>
          <button style={s.ghostBtn} onClick={() => { setShowingForm(false); setShowingDraft(null) }}>Cancel</button>
        </div>
        <div style={s.formGrid}>
          <div>
            <FL>Date</FL>
            <input type="date" style={s.field} value={showingDraft.date} onChange={e => upd('date', e.target.value)} />
          </div>
          <div>
            <FL>Property Address</FL>
            <AddressAutocomplete value={showingDraft.address} onChange={v => upd('address', v)} />
          </div>
        </div>
        <div style={s.showingFields}>
          <div><FL>What they responded to — lingered on, got excited about</FL><textarea style={s.textarea} value={showingDraft.respondedTo} placeholder="Features, rooms, moments that created energy..." onChange={e => upd('respondedTo', e.target.value)} /></div>
          <div><FL>What they pulled back from — dismissed or hesitated on</FL><textarea style={s.textarea} value={showingDraft.pulledBackFrom} placeholder="What they brushed past, questioned, or rejected..." onChange={e => upd('pulledBackFrom', e.target.value)} /></div>
          <div><FL>What became more true about the hypothesis</FL><textarea style={s.textarea} value={showingDraft.moreTrue} placeholder="Evidence that confirmed what we believed..." onChange={e => upd('moreTrue', e.target.value)} /></div>
          <div><FL>What became less true about the hypothesis</FL><textarea style={s.textarea} value={showingDraft.lessTrue} placeholder="Evidence that challenged what we believed..." onChange={e => upd('lessTrue', e.target.value)} /></div>
          <div><FL>How does the North Star change?</FL><textarea style={{ ...s.textarea, borderColor: '#b0c8a0' }} value={showingDraft.hypothesisUpdate} placeholder="How does this shift the picture?" onChange={e => upd('hypothesisUpdate', e.target.value)} /></div>
        </div>
        <button style={s.primaryBtn} onClick={() => saveShowing(showingDraft)}>Save showing</button>
      </div>
    )
  }

  return (
    <div style={s.pane}>
      <div style={s.showingsListHeader}>
        <span style={s.sectionLabel}>SHOWINGS ({buyer.showings.length})</span>
      </div>
      {sorted.length === 0 && <div style={s.emptyList}>No showings logged yet. Use the button above to log the first one.</div>}
      {sorted.map(sh => (
        <div key={sh.id} style={s.showingCard}>
          <div style={s.showingCardTop}>
            <div>
              <div style={s.showingAddr}>{sh.address || 'No address'}</div>
              <div style={s.showingDate}>{sh.date ? new Date(sh.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={s.ghostBtn} onClick={() => openEditShowing(sh)}>Edit</button>
              <button style={s.dangerBtn} onClick={() => { if (window.confirm('Delete this showing?')) deleteShowing(sh.id) }}>Delete</button>
            </div>
          </div>
          {sh.hypothesisUpdate && <div style={s.hypothesisUpdate}><span style={s.updateLabel}>North Star update: </span>{sh.hypothesisUpdate}</div>}
          <div style={s.showingDebrief}>
            {sh.respondedTo && <div><span style={s.debriefLabel}>Responded to: </span>{sh.respondedTo}</div>}
            {sh.pulledBackFrom && <div><span style={s.debriefLabel}>Pulled back from: </span>{sh.pulledBackFrom}</div>}
            {sh.moreTrue && <div><span style={s.debriefLabel}>↑ More true: </span>{sh.moreTrue}</div>}
            {sh.lessTrue && <div><span style={s.debriefLabel}>↓ Less true: </span>{sh.lessTrue}</div>}
          </div>
        </div>
      ))}
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
      <div style={s.sectionLabel}>HYPOTHESIS EVOLUTION</div>
      {buyer.showings.length === 0
        ? <div style={s.emptyList}>Log showings to track how the hypothesis evolves.</div>
        : (
          <div style={s.timeline}>
            <div style={s.timelineItem}>
              <div style={s.timelineDot} />
              <div>
                <div style={s.timelineLabel}>Initial hypothesis</div>
                <div style={s.timelineText}>{count > 0 ? `${ns.propertyType || '—'} in ${ns.location || '—'} · ${ns.motivation || '—'}` : 'Not yet built.'}</div>
              </div>
            </div>
            {withUpdates.length === 0
              ? <div style={{ paddingLeft: 24, fontSize: 12, color: '#a09a8e', fontStyle: 'italic' }}>No hypothesis updates logged yet.</div>
              : withUpdates.map((sh, i) => (
                <div key={sh.id} style={s.timelineItem}>
                  <div style={s.timelineDot} />
                  <div>
                    <div style={s.timelineLabel}>After showing {i + 1}{sh.address ? ` · ${sh.address}` : ''}</div>
                    <div style={s.timelineText}>{sh.hypothesisUpdate}</div>
                  </div>
                </div>
              ))}
          </div>
        )}
    </div>
  )
}

// ─── SHARED ───────────────────────────────────────────────────────────────────
function FL({ children }) {
  return <div style={s.fieldLabel}>{children}</div>
}

function AddressAutocomplete({ value, onChange, placeholder = 'Start typing an address...' }) {
  const [query, setQuery] = useState(value || '')
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)
  useEffect(() => { setQuery(value || '') }, [value])
  const search = q => {
    if (timer.current) clearTimeout(timer.current)
    if (q.length < 4) { setSuggestions([]); return }
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&countrycodes=us`, { headers: { 'Accept-Language': 'en' } })
        const data = await res.json()
        setSuggestions(data.map(r => r.display_name))
        setOpen(true)
      } catch (_) {}
      setLoading(false)
    }, 350)
  }
  const select = addr => {
    const clean = addr.split(', United States')[0]
    setQuery(clean); onChange(clean); setSuggestions([]); setOpen(false)
  }
  return (
    <div style={{ position: 'relative' }}>
      <input style={{ ...s.field, paddingRight: 28 }} value={query} placeholder={placeholder} autoComplete="off"
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); search(e.target.value) }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)} />
      {loading && <span style={s.addrSpinner}>⟳</span>}
      {open && suggestions.length > 0 && (
        <div style={s.addrDropdown}>
          {suggestions.map((sg, i) => <div key={i} style={s.addrOption} onMouseDown={() => select(sg)}>{sg.split(', United States')[0]}</div>)}
        </div>
      )}
    </div>
  )
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s = {
  shell: { display: 'flex', height: '100vh', fontFamily: "Georgia, 'Times New Roman', serif", background: '#f5f2ee', color: '#1e1c1a', overflow: 'hidden' },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flex: 1 },

  sidebar: { width: 230, minWidth: 230, background: '#edeae5', borderRight: '1px solid #ddd8d0', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  sidebarTop: { padding: '14px 14px 10px', borderBottom: '1px solid #ddd8d0' },
  brandMark: { fontSize: 9, letterSpacing: '0.22em', color: '#4a6e3a', fontWeight: 'bold', marginBottom: 2 },
  brandSub: { fontSize: 10, color: '#a09a8e', marginBottom: 8 },
  userRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  userName: { fontSize: 11, color: '#5a5550' },
  signOutBtn: { fontSize: 10, color: '#a09a8e', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  mindsetToggle: { display: 'flex', justifyContent: 'space-between', padding: '9px 14px', background: 'none', border: 'none', borderBottom: '1px solid #ddd8d0', cursor: 'pointer', width: '100%', fontFamily: 'Georgia, serif', fontSize: 9, letterSpacing: '0.16em', color: '#6a6460', fontWeight: 'bold' },
  toggleArrow: { fontSize: 8 },
  mindsetPanel: { padding: '12px 14px', borderBottom: '1px solid #ddd8d0', background: '#e8e4de', overflowY: 'auto', maxHeight: 240 },
  mindsetItem: { marginBottom: 12 },
  mindsetTitle: { fontSize: 11, fontWeight: 'bold', color: '#2a2521', marginBottom: 3 },
  mindsetBody: { fontSize: 11, color: '#5a5550', lineHeight: 1.6 },
  divider: { height: 1, background: '#ddd8d0' },

  buyerHeader: { display: 'flex', gap: 6, padding: '10px 12px 6px', alignItems: 'center' },
  search: { flex: 1, padding: '6px 10px', border: '1px solid #d0cbc4', borderRadius: 3, background: '#f5f2ee', fontSize: 12, fontFamily: 'Georgia, serif', color: '#1e1c1a', outline: 'none' },
  addBtn: { width: 28, height: 28, background: '#4a6e3a', color: '#fff', border: 'none', borderRadius: 3, fontSize: 20, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 },

  filterBar: { padding: '0 12px 6px' },
  filterToggle: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '5px 8px', background: 'none', border: '1px solid #d0cbc4', borderRadius: 3, cursor: 'pointer', fontFamily: 'Georgia, serif', fontSize: 11, color: '#6a6460' },
  filterPanel: { padding: '10px 8px 6px', display: 'flex', flexDirection: 'column', gap: 10 },
  filterRow: { display: 'flex', flexDirection: 'column', gap: 4 },
  filterLabel: { fontSize: 9, letterSpacing: '0.12em', color: '#a09a8e', fontWeight: 'bold' },
  filterSelect: { width: '100%', padding: '5px 8px', border: '1px solid #d0cbc4', borderRadius: 3, background: '#f5f2ee', fontSize: 12, fontFamily: 'Georgia, serif', cursor: 'pointer', color: '#1e1c1a' },
  statusChips: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  chip: { padding: '3px 7px', fontSize: 10, borderRadius: 3, border: '1px solid #d0cbc4', background: 'transparent', cursor: 'pointer', color: '#6a6460', fontFamily: 'Georgia, serif' },
  chipActive: { background: '#4a6e3a', color: '#fff', borderColor: '#4a6e3a' },
  clearFilters: { fontSize: 11, color: '#a06050', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif', textAlign: 'left', padding: '0 8px' },

  buyerCount: { fontSize: 10, color: '#a09a8e', padding: '2px 14px 6px', letterSpacing: '0.06em' },
  buyerList: { flex: 1, overflowY: 'auto' },
  buyerItem: { padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #ddd8d0' },
  buyerItemActive: { background: '#f5f2ee', borderLeft: '3px solid #4a6e3a', paddingLeft: 11 },
  buyerName: { fontSize: 13, fontWeight: 'bold', color: '#1e1c1a', marginBottom: 1 },
  buyerSpouse: { fontSize: 11, color: '#6a6460', marginBottom: 1 },
  buyerAgent: { fontSize: 10, color: '#a09a8e' },
  emptyList: { fontSize: 12, color: '#a09a8e', padding: '12px 14px', fontStyle: 'italic' },

  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '16px 24px 12px', borderBottom: '1px solid #ddd8d0', flexShrink: 0 },
  headerName: { fontSize: 20, fontWeight: 'bold', color: '#1e1c1a', marginBottom: 3 },
  headerSpouse: { fontSize: 16, color: '#7a7570', fontWeight: 'normal' },
  headerMeta: { fontSize: 12, color: '#a09a8e' },
  headerRight: { display: 'flex', gap: 8, alignItems: 'center' },
  statusSelect: { padding: '5px 10px', borderRadius: 3, border: '1px solid #d0cbc4', background: '#f5f2ee', fontSize: 12, fontFamily: 'Georgia, serif', cursor: 'pointer' },

  nsPinned: { background: '#fff', borderBottom: '1px solid #ddd8d0', padding: '12px 24px', flexShrink: 0 },
  nsTopRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  nsLabelRow: { display: 'flex', alignItems: 'center', gap: 10 },
  nsLabel: { fontSize: 9, letterSpacing: '0.18em', color: '#4a6e3a', fontWeight: 'bold' },
  nsBar: { width: 60, height: 3, background: '#e8e4de', borderRadius: 2, overflow: 'hidden' },
  nsBarFill: { height: '100%', background: '#4a6e3a', borderRadius: 2, transition: 'width 0.3s' },
  nsCount: { fontSize: 10, color: '#a09a8e' },
  nsEditBtn: { fontSize: 11, padding: '3px 12px', border: '1px solid #d0cbc4', borderRadius: 3, background: 'transparent', cursor: 'pointer', fontFamily: 'Georgia, serif', color: '#5a5550' },

  nsChips: { display: 'flex', flexWrap: 'wrap', gap: 6, cursor: 'pointer' },
  nsChipFilled: { fontSize: 12, background: '#f0f7ea', border: '1px solid #c0d8b0', borderRadius: 3, padding: '4px 10px', color: '#2a5a1a' },
  nsChipEmpty: { fontSize: 12, background: '#faf8f5', border: '1px dashed #d0cbc4', borderRadius: 3, padding: '4px 10px', color: '#b0a898', fontStyle: 'italic' },

  nsBuckets: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 },
  nsBucket: { border: '1px solid #e0dbd4', borderRadius: 5, overflow: 'hidden' },
  nsBucketHeader: { background: '#f0f7ea', borderBottom: '1px solid #c8ddb8', padding: '8px 12px' },
  nsBucketTitle: { fontSize: 9, letterSpacing: '0.16em', color: '#4a6e3a', fontWeight: 'bold' },
  nsBucketSub: { fontSize: 10, color: '#7a9a6a', marginTop: 1 },
  nsBucketBody: { padding: '12px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 10 },
  nsField: { width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: '1px solid #e0dbd4', borderRadius: 3, background: '#faf8f5', fontSize: 12, fontFamily: 'Georgia, serif', color: '#1e1c1a', outline: 'none' },

  actionBar: { display: 'flex', gap: 10, padding: '10px 24px', borderBottom: '1px solid #ddd8d0', background: '#faf8f5', flexShrink: 0 },
  actionBtn: { padding: '8px 16px', border: '1px solid #d0cbc4', borderRadius: 3, background: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', color: '#3a3530' },
  actionBtnPrimary: { padding: '8px 20px', border: 'none', borderRadius: 3, background: '#4a6e3a', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', color: '#fff', fontWeight: 'bold' },

  tabBar: { display: 'flex', padding: '0 24px', borderBottom: '1px solid #ddd8d0', flexShrink: 0, background: '#faf8f5', overflowX: 'auto' },
  tab: { padding: '9px 14px', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontSize: 12, cursor: 'pointer', color: '#8a8480', fontFamily: 'Georgia, serif', marginBottom: -1, whiteSpace: 'nowrap' },
  tabActive: { color: '#1e1c1a', borderBottomColor: '#4a6e3a', fontWeight: 'bold' },
  tabContent: { flex: 1, overflowY: 'auto', padding: '20px 24px' },
  pane: { maxWidth: 820 },
  sectionLabel: { fontSize: 10, letterSpacing: '0.14em', color: '#8a8480', fontWeight: 'bold', marginBottom: 14, display: 'block' },

  contactCard: { border: '1px solid #e0dbd4', borderRadius: 5, padding: '16px', marginBottom: 12, background: '#faf8f5' },
  contactCardPrimary: { borderColor: '#b0c8a0', background: '#f5faf2' },
  contactCardTop: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  roleInput: { fontSize: 11, fontWeight: 'bold', letterSpacing: '0.08em', color: '#5a5550', background: 'transparent', border: 'none', borderBottom: '1px dashed #ccc8c0', outline: 'none', padding: '2px 4px', fontFamily: 'Georgia, serif', textTransform: 'uppercase', width: 160 },
  primaryBadge: { fontSize: 10, background: '#4a6e3a', color: '#fff', padding: '2px 8px', borderRadius: 10 },
  setPrimaryBtn: { fontSize: 10, background: 'none', border: '1px solid #ccc8c0', borderRadius: 10, color: '#8a8480', padding: '2px 8px', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  contactGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' },

  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' },
  fieldLabel: { fontSize: 10, letterSpacing: '0.08em', color: '#8a8480', textTransform: 'uppercase', marginBottom: 5 },
  field: { width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #e0dbd4', borderRadius: 4, background: '#fff', fontSize: 13, fontFamily: 'Georgia, serif', color: '#1e1c1a', outline: 'none' },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #e0dbd4', borderRadius: 4, background: '#fff', fontSize: 13, fontFamily: 'Georgia, serif', color: '#1e1c1a', outline: 'none', resize: 'vertical', minHeight: 90, lineHeight: 1.6 },
  profileNote: { fontSize: 12, color: '#a09a8e', fontStyle: 'italic', marginBottom: 16 },

  primaryBtn: { padding: '9px 20px', border: 'none', borderRadius: 3, background: '#4a6e3a', color: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  ghostBtn: { padding: '7px 14px', borderRadius: 3, border: '1px solid #d0cbc4', background: 'transparent', color: '#6a6460', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  dangerBtn: { padding: '7px 14px', borderRadius: 3, border: '1px solid #d0b0a8', background: 'transparent', color: '#a06050', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  showingFormHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  showingFields: { display: 'flex', flexDirection: 'column', gap: 14, margin: '16px 0' },
  showingsListHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  showingCard: { background: '#fff', border: '1px solid #e0dbd4', borderRadius: 5, padding: '14px 16px', marginBottom: 12 },
  showingCardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  showingAddr: { fontSize: 14, fontWeight: 'bold', color: '#1e1c1a' },
  showingDate: { fontSize: 11, color: '#a09a8e', marginTop: 2 },
  hypothesisUpdate: { background: '#eef6e8', borderRadius: 3, padding: '7px 12px', fontSize: 12, color: '#2a4a1a', marginBottom: 8 },
  updateLabel: { fontWeight: 'bold', color: '#4a6e3a' },
  showingDebrief: { fontSize: 12, color: '#5a5550', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 3 },
  debriefLabel: { fontWeight: 'bold' },

  timeline: { borderLeft: '2px solid #e0dbd4', paddingLeft: 20, marginLeft: 6 },
  timelineItem: { position: 'relative', paddingBottom: 20, display: 'flex', gap: 14 },
  timelineDot: { width: 10, height: 10, borderRadius: '50%', background: '#4a6e3a', flexShrink: 0, marginTop: 3, marginLeft: -25 },
  timelineLabel: { fontSize: 11, color: '#a09a8e', marginBottom: 3 },
  timelineText: { fontSize: 13, color: '#1e1c1a', lineHeight: 1.5 },

  emptyTitle: { fontSize: 22, fontWeight: 'bold', color: '#1e1c1a', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#a09a8e', marginBottom: 20 },

  addrSpinner: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#a09a8e' },
  addrDropdown: { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #d0cbc4', borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', zIndex: 100, maxHeight: 220, overflowY: 'auto' },
  addrOption: { padding: '9px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #f0ede8', color: '#1e1c1a', fontFamily: 'Georgia, serif', lineHeight: 1.4 },
}
