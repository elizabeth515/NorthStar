import { useState } from 'react'
import { supabase } from './supabase'

export default function Login() {
  const [mode, setMode] = useState('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const handleSubmit = async () => {
    setError('')
    setMessage('')
    setLoading(true)

    if (mode === 'signup') {
      if (!name.trim()) { setError('Enter your name.'); setLoading(false); return }
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) { setError(signUpError.message); setLoading(false); return }
      if (data?.user) {
        await supabase.from('agents').upsert({ id: data.user.id, email, name: name.trim() })
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) setError(signInError.message)
    }
    setLoading(false)
  }

  return (
    <div style={s.shell}>
      <div style={s.card}>
        <div style={s.brand}>BUILD THE HOUSE</div>
        <div style={s.sub}>Buyer Framework</div>

        <div style={s.toggleRow}>
          <button style={{ ...s.toggle, ...(mode === 'signin' ? s.toggleActive : {}) }} onClick={() => { setMode('signin'); setError(''); setMessage('') }}>Sign in</button>
          <button style={{ ...s.toggle, ...(mode === 'signup' ? s.toggleActive : {}) }} onClick={() => { setMode('signup'); setError(''); setMessage('') }}>Create account</button>
        </div>

        {mode === 'signup' && (
          <div style={s.field}>
            <label style={s.label}>Your Name</label>
            <input style={s.input} value={name} placeholder="First Last" onChange={e => setName(e.target.value)} />
          </div>
        )}
        <div style={s.field}>
          <label style={s.label}>Email</label>
          <input style={s.input} type="email" value={email} placeholder="you@firm.com" onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>
        <div style={s.field}>
          <label style={s.label}>Password</label>
          <input style={s.input} type="password" value={password} placeholder="••••••••" onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>

        {error && <div style={s.error}>{error}</div>}
        {message && <div style={s.success}>{message}</div>}

        <button style={s.btn} onClick={handleSubmit} disabled={loading}>
          {loading ? 'Working...' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </div>
    </div>
  )
}

const s = {
  shell: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f5f2ee' },
  card: { width: 360, background: '#fff', border: '1px solid #d8d2c8', borderRadius: 6, padding: '36px 32px' },
  brand: { fontSize: 11, letterSpacing: '0.2em', color: '#5a7a4a', fontWeight: 'bold', marginBottom: 4, textAlign: 'center' },
  sub: { fontSize: 12, color: '#a09a8e', textAlign: 'center', marginBottom: 28 },
  toggleRow: { display: 'flex', marginBottom: 24, border: '1px solid #d8d2c8', borderRadius: 4, overflow: 'hidden' },
  toggle: { flex: 1, padding: '8px', border: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', color: '#8a8480' },
  toggleActive: { background: '#5a7a4a', color: '#fff' },
  field: { marginBottom: 16 },
  label: { display: 'block', fontSize: 11, letterSpacing: '0.08em', color: '#7a7570', textTransform: 'uppercase', marginBottom: 5 },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #d8d2c8', borderRadius: 4, fontSize: 14, fontFamily: 'Georgia, serif', outline: 'none', color: '#2a2521' },
  error: { fontSize: 12, color: '#a05040', marginBottom: 14, padding: '8px 10px', background: '#fdf0ee', borderRadius: 3 },
  success: { fontSize: 12, color: '#3a6a2a', marginBottom: 14, padding: '8px 10px', background: '#f0f7ec', borderRadius: 3 },
  btn: { width: '100%', padding: '11px', background: '#5a7a4a', color: '#fff', border: 'none', borderRadius: 4, fontSize: 14, cursor: 'pointer', fontFamily: 'Georgia, serif' },
}
