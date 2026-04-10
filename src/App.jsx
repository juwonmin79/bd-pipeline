import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'
import Planning from './pages/Planning'
import Reserve from './pages/Reserve'
import Note from './pages/Note'

// ── PIN 암호화/복호화 헬퍼 ────────────────────────
async function deriveKey(pin) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(pin.padEnd(32,'0')), { name:'AES-GCM' }, false, ['encrypt','decrypt'])
}
async function encryptPw(pin, password) {
  const key = await deriveKey(pin)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(password))
  const combined = new Uint8Array(iv.length + enc.byteLength)
  combined.set(iv); combined.set(new Uint8Array(enc), iv.length)
  return btoa(String.fromCharCode(...combined))
}
async function decryptPw(pin, encrypted) {
  try {
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
    const key = await deriveKey(pin)
    const dec = await crypto.subtle.decrypt({ name:'AES-GCM', iv: combined.slice(0,12) }, key, combined.slice(12))
    return new TextDecoder().decode(dec)
  } catch { return null }
}
async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')
}

const getAlias = (session) =>
  session?.user?.user_metadata?.alias ||
  session?.user?.email?.split('@')[0] ||
  '?'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [gear, setGear] = useState('planning')
  const [planningTab, setPlanningTab] = useState('team')
  const [collapsed, setCollapsed] = useState(false)
  const [darkMode, setDarkMode] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [onlineUsers, setOnlineUsers] = useState([])
  const [toast, setToast] = useState(null)
  const [needPinSetup, setNeedPinSetup] = useState(false)
  const [pinSetupPassword, setPinSetupPassword] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [changePwOpen, setChangePwOpen] = useState(false)
  const [changePinOpen, setChangePinOpen] = useState(false)
  const presenceChannelRef = useRef(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s ?? null))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!pinSetupPassword || !session) return
    const savedEnc = localStorage.getItem('bd_enc')
    if (!savedEnc) setNeedPinSetup(true)
  }, [pinSetupPassword, session])

  // Presence
  useEffect(() => {
    if (!session) return
    const alias = getAlias(session)
    const userId = session.user.id
    const channel = supabase.channel('bd-presence', { config: { presence: { key: userId } } })
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        setOnlineUsers(Object.entries(state).map(([uid, arr]) => ({ userId: uid, alias: arr[arr.length-1]?.alias || '?' })))
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        newPresences.forEach(p => { if (p.userId !== userId) showToast(`${p.alias}님이 접속했어요 👋`) })
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        leftPresences.forEach(p => { if (p.userId !== userId) showToast(`${p.alias}님이 나갔어요`) })
      })
    channel.subscribe(async (status) => { if (status === 'SUBSCRIBED') await channel.track({ alias, userId }) })
    presenceChannelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [session])

  const dk = darkMode
  const bg = dk ? '#0d0d0d' : '#f9fafb'
  const sidebarBg = dk ? '#111' : '#ffffff'
  const border = dk ? '#1f1f1f' : '#e5e7eb'
  const textPrimary = dk ? '#f0f0f0' : '#111827'
  const textMuted = dk ? '#6b7280' : '#6b7280'

  if (session === undefined) return (
    <div style={{ minHeight:'100vh', background: bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:8, height:8, borderRadius:'50%', background:'#7c3aed' }} />
    </div>
  )

  if (session === null) return (
    <LoginScreen darkMode={dk} setDarkMode={setDarkMode} onLoginSuccess={(pw) => setPinSetupPassword(pw)} />
  )

  const alias = getAlias(session)

  const GEARS = [
    { key:'planning', label:'Planning', badge:'P', color:'#EEEDFE', textColor:'#3C3489' },
    { key:'reserve',  label:'Reserve',  badge:'R', color:'#E1F5EE', textColor:'#085041' },
    { key:'note',     label:'Note',     badge:'N', color:'#E6F1FB', textColor:'#0C447C' },
    { key:'dev',      label:'Dev',      badge:'D', color: dk?'#1a1a1a':'#f3f4f6', textColor:textMuted, locked:true },
  ]
  const PLANNING_TABS = [
    { key:'team', label:'Team' }, { key:'my', label:'My' },
    { key:'simulate', label:'Simulate' }, { key:'target', label:'Target' },
  ]

  return (
    <div style={{ display:'flex', height:'100vh', background: bg, fontFamily:"'Geist', sans-serif" }}>

      {/* SIDEBAR */}
      <div style={{ width: collapsed ? 48 : 200, minWidth: collapsed ? 48 : 200, transition:'width 0.2s ease, min-width 0.2s ease', background: sidebarBg, borderRight:`1px solid ${border}`, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* 브랜드 */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 12px', borderBottom:`1px solid ${border}`, minHeight:48 }}>
          {!collapsed && (
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <div style={{ width:20, height:20, borderRadius:5, background:'linear-gradient(135deg,#175BFF,#8A2BFF)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <span style={{ fontSize:9, fontWeight:700, color:'white', letterSpacing:'-0.5px' }}>BD</span>
              </div>
              <span style={{ fontSize:12, fontWeight:500, color:textPrimary, whiteSpace:'nowrap' }}>Sales<span style={{ color:'#7c3aed' }}>Gear</span></span>
            </div>
          )}
          <button onClick={() => setCollapsed(c => !c)} style={{ width:20, height:20, borderRadius:4, border:`1px solid ${border}`, background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:textMuted, fontSize:10, flexShrink:0, marginLeft: collapsed ? 'auto' : 0 }}>
            {collapsed ? '▶' : '◀'}
          </button>
        </div>

        {/* 네비 */}
        <nav style={{ flex:1, padding:'8px 0', overflowY:'auto' }}>
          {GEARS.map(g => (
            <div key={g.key}>
              <div onClick={() => !g.locked && setGear(g.key)} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 12px', cursor: g.locked ? 'default' : 'pointer', background: gear===g.key ? (dk?'#1a1a1a':'#f5f3ff') : 'transparent', borderRight: gear===g.key ? '2px solid #7c3aed' : '2px solid transparent', opacity: g.locked ? 0.4 : 1 }}>
                <div style={{ width:24, height:24, borderRadius:6, background:g.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:500, color:g.textColor, flexShrink:0 }}>{g.badge}</div>
                {!collapsed && <span style={{ fontSize:12, fontWeight:500, color: g.locked ? textMuted : textPrimary, whiteSpace:'nowrap' }}>{g.label}</span>}
              </div>
              {!collapsed && gear==='planning' && g.key==='planning' && (
                <div style={{ paddingLeft:46, paddingBottom:4 }}>
                  {PLANNING_TABS.map(t => (
                    <div key={t.key} onClick={() => setPlanningTab(t.key)} style={{ fontSize:11, padding:'5px 10px', borderRadius:6, cursor:'pointer', color: planningTab===t.key ? '#7c3aed' : textMuted, fontWeight: planningTab===t.key ? 500 : 400, background: planningTab===t.key ? (dk?'#1e1635':'#ede9fe') : 'transparent', whiteSpace:'nowrap' }}>{t.label}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* 접속 중 유저 */}
        {!collapsed && onlineUsers.length > 0 && (
          <div style={{ padding:'8px 12px', borderTop:`1px solid ${border}`, display:'flex', alignItems:'center', gap:4 }}>
            <div style={{ width:6, height:6, borderRadius:'50%', background:'#4ade80', flexShrink:0 }} />
            <span style={{ fontSize:10, color:textMuted, marginRight:4 }}>{onlineUsers.length}명</span>
            {onlineUsers.slice(0,5).map((u, i) => {
              const isMe = u.userId === session?.user?.id
              return (
                <div key={u.userId} title={u.alias+(isMe?' (나)':'')} style={{ width:22, height:22, borderRadius:'50%', background:isMe?(dk?'#1e1635':'#ede9fe'):(dk?'#1a2a1a':'#dcfce7'), border:`2px solid ${isMe?'#7c3aed':'#4ade80'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:600, color:isMe?'#a78bfa':'#16a34a', marginLeft:i===0?0:-5, zIndex:10-i, cursor:'default' }}>
                  {u.alias?.[0]?.toUpperCase()||'?'}
                </div>
              )
            })}
          </div>
        )}

        {/* 푸터 유저 */}
        <div style={{ padding:'10px 12px', borderTop:`1px solid ${border}`, display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ position:'relative' }}>
            <div onClick={() => setProfileOpen(o => !o)} style={{ width:24, height:24, borderRadius:'50%', background: dk?'#1e1635':'#ede9fe', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:500, color: dk?'#a78bfa':'#7c3aed', flexShrink:0, cursor:'pointer' }}>
              {alias.slice(0,2).toUpperCase()}
            </div>
            {profileOpen && (
              <>
                <div style={{ position:'fixed', inset:0, zIndex:99 }} onClick={() => setProfileOpen(false)} />
                <div style={{ position:'absolute', bottom:'calc(100% + 8px)', left:0, zIndex:100, background:dk?'#111':'#fff', border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, borderRadius:10, minWidth:200, overflow:'hidden', boxShadow:dk?'0 8px 24px rgba(0,0,0,0.5)':'0 8px 24px rgba(0,0,0,0.1)', fontFamily:"'Geist', sans-serif" }}>
                  <div style={{ padding:'12px 14px', borderBottom:`1px solid ${dk?'#1f1f1f':'#f0f0f0'}` }}>
                    <div style={{ fontSize:13, fontWeight:500, color:dk?'#f0f0f0':'#111827' }}>{alias}</div>
                    <div style={{ fontSize:11, color:'#6b7280', marginTop:2 }}>{session?.user?.email}</div>
                  </div>
                  <button onClick={() => { setProfileOpen(false); setChangePwOpen(true) }} style={{ width:'100%', padding:'10px 14px', border:'none', background:'transparent', textAlign:'left', fontSize:12, color:dk?'#d1d5db':'#374151', cursor:'pointer', fontFamily:"'Geist', sans-serif", borderBottom:`1px solid ${dk?'#1f1f1f':'#f0f0f0'}` }}
                    onMouseEnter={e => e.currentTarget.style.background=dk?'#1a1a1a':'#f9fafb'} onMouseLeave={e => e.currentTarget.style.background='transparent'}>🔑 비밀번호 변경</button>
                  <button onClick={() => { setProfileOpen(false); setChangePinOpen(true) }} style={{ width:'100%', padding:'10px 14px', border:'none', background:'transparent', textAlign:'left', fontSize:12, color:dk?'#d1d5db':'#374151', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                    onMouseEnter={e => e.currentTarget.style.background=dk?'#1a1a1a':'#f9fafb'} onMouseLeave={e => e.currentTarget.style.background='transparent'}>{localStorage.getItem('bd_enc')?'🔐 PIN 변경':'🔐 PIN 설정'}</button>
                </div>
              </>
            )}
          </div>
          {!collapsed && <span style={{ fontSize:11, color:textMuted, whiteSpace:'nowrap', overflow:'hidden' }}>{alias}</span>}
          {!collapsed && (
            <div style={{ marginLeft:'auto', display:'flex', gap:4 }}>
              <button onClick={() => setDarkMode(d => !d)} style={{ fontSize:10, padding:'2px 6px', borderRadius:4, border:`1px solid ${border}`, background:'transparent', color:textMuted, cursor:'pointer' }}>{dk?'☀️':'🌙'}</button>
              <button onClick={async () => { if (presenceChannelRef.current) await presenceChannelRef.current.untrack(); supabase.auth.signOut() }} style={{ fontSize:10, padding:'2px 6px', borderRadius:4, border:`1px solid ${border}`, background:'transparent', color:textMuted, cursor:'pointer' }}>out</button>
            </div>
          )}
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
        {gear === 'planning' && <Planning tab={planningTab} darkMode={dk} session={session} />}
        {gear === 'reserve'  && <Reserve darkMode={dk} session={session} />}
        {gear === 'note'     && <Note darkMode={dk} session={session} />}
      </div>

      {/* 모달들 */}
      {needPinSetup && <PinSetupModal darkMode={dk} session={session} password={pinSetupPassword} onDone={() => { setNeedPinSetup(false); setPinSetupPassword('') }} />}
      {changePwOpen && <ChangePwModal darkMode={dk} session={session} onClose={() => setChangePwOpen(false)} onSuccess={(msg) => { setChangePwOpen(false); showToast(msg) }} />}
      {changePinOpen && <PinSetupModal darkMode={dk} session={session} onDone={() => { setChangePinOpen(false); showToast('PIN이 변경됐어요 ✓') }} />}

      {/* 토스트 */}
      {toast && (
        <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:toast.type==='info'?(dk?'#0f2010':'#f0fdf4'):(dk?'#1e1635':'#ede9fe'), border:`1px solid ${toast.type==='info'?'#4ade80':'#7c3aed'}`, color:toast.type==='info'?(dk?'#4ade80':'#16a34a'):(dk?'#c4b5fd':'#5b21b6'), padding:'10px 18px', borderRadius:8, fontSize:13, fontWeight:500, fontFamily:"'Geist', sans-serif" }}>{toast.msg}</div>
      )}
    </div>
  )
}

// ── ChangePwModal ─────────────────────────────────
function ChangePwModal({ darkMode, session, onClose, onSuccess }) {
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const dk = darkMode
  const modalBg = dk?'#111':'#ffffff'; const modalBdr = dk?'#2a1f5c':'#e5e7eb'
  const headerBg = dk?'#1e1635':'#f5f3ff'
  const inputStyle = { fontSize:13, padding:'9px 11px', borderRadius:8, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:dk?'#1a1a1a':'#f3f4f6', color:dk?'#f0f0f0':'#111827', outline:'none', fontFamily:"'Geist', sans-serif", width:'100%', boxSizing:'border-box' }
  const handleSave = async () => {
    if (newPw.length < 6) { setError('6자 이상 입력해주세요'); return }
    if (newPw !== confirm) { setError('비밀번호가 일치하지 않아요'); return }
    setLoading(true); setError(null)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    if (error) { setError(error.message); setLoading(false); return }
    setLoading(false)
    setTimeout(() => onClose(), 1000)
    onSuccess('비밀번호가 변경됐어요 ✓')
  }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000, padding:20 }}>
      <div style={{ background:modalBg, border:`1px solid ${modalBdr}`, borderRadius:12, width:'100%', maxWidth:360, overflow:'hidden', fontFamily:"'Geist', sans-serif" }}>
        <div style={{ background:headerBg, padding:'14px 20px', borderBottom:`1px solid ${modalBdr}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:13, fontWeight:500, color:dk?'#c4b5fd':'#5b21b6' }}>🔑 비밀번호 변경</div>
        </div>
        <div style={{ padding:'20px', display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}><label style={{ fontSize:11, color:'#6b7280' }}>새 비밀번호</label><input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="6자 이상" style={inputStyle} autoFocus /></div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}><label style={{ fontSize:11, color:'#6b7280' }}>비밀번호 확인</label><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key==='Enter'&&handleSave()} placeholder="동일하게 입력" style={inputStyle} /></div>
          {error && <div style={{ fontSize:12, color:'#f87171' }}>{error}</div>}
        </div>
        <div style={{ padding:'12px 20px', background:dk?'#0d0d0d':'#f9fafb', display:'flex', justifyContent:'flex-end', gap:8, borderTop:`1px solid ${modalBdr}` }}>
          <button onClick={onClose} style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>나중에</button>
          <button onClick={handleSave} disabled={loading} style={{ fontSize:12, padding:'6px 16px', borderRadius:6, border:'none', background:loading?'#4c1d95':'#7c3aed', color:'#f0f0f0', cursor:loading?'not-allowed':'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" }}>{loading?'변경 중...':'변경'}</button>
        </div>
      </div>
    </div>
  )
}

// ── PinSetupModal ─────────────────────────────────
function PinSetupModal({ darkMode, session, password, onDone }) {
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [currentPw, setCurrentPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const dk = darkMode
  const modalBg = dk?'#111':'#ffffff'; const modalBdr = dk?'#2a1f5c':'#e5e7eb'
  const headerBg = dk?'#1e1635':'#f5f3ff'
  const pinStyle = { fontSize:24, letterSpacing:10, textAlign:'center', fontWeight:500, padding:'9px 11px', borderRadius:8, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:dk?'#1a1a1a':'#f3f4f6', color:dk?'#f0f0f0':'#111827', outline:'none', fontFamily:"'Geist', sans-serif", width:'100%', boxSizing:'border-box' }
  const inputStyle = { ...pinStyle, fontSize:13, letterSpacing:'normal', textAlign:'left' }
  const handleSave = async () => {
    const pw = password || currentPw
    if (!pw) { setError('현재 비밀번호를 입력해주세요'); return }
    if (pin.length !== 6 || !/^\d+$/.test(pin)) { setError('숫자 6자리를 입력해주세요'); return }
    if (pin !== pinConfirm) { setError('PIN이 일치하지 않아요'); return }
    setLoading(true); setError(null)
    if (!password) {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: session.user.email, password: currentPw })
      if (authError) { setError('비밀번호가 틀렸어요'); setLoading(false); return }
    }
    const encrypted = await encryptPw(pin, pw)
    localStorage.setItem('bd_enc', encrypted)
    const hash = await hashPin(pin)
    const { error } = await supabase.from('users').update({ pin_hash: hash }).eq('id', session.user.id)
    if (error) { setError(error.message); setLoading(false); return }
    setLoading(false); onDone()
  }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000, padding:20 }}>
      <div style={{ background:modalBg, border:`1px solid ${modalBdr}`, borderRadius:12, width:'100%', maxWidth:360, overflow:'hidden', fontFamily:"'Geist', sans-serif" }}>
        <div style={{ background:headerBg, padding:'14px 20px', borderBottom:`1px solid ${modalBdr}` }}>
          <div style={{ fontSize:13, fontWeight:500, color:dk?'#c4b5fd':'#5b21b6' }}>🔐 PIN 설정</div>
          <div style={{ fontSize:11, color:'#6b7280', marginTop:3 }}>6자리 PIN으로 빠르게 로그인</div>
        </div>
        <div style={{ padding:'20px', display:'flex', flexDirection:'column', gap:14 }}>
          {!password && <div style={{ display:'flex', flexDirection:'column', gap:6 }}><label style={{ fontSize:11, color:'#6b7280' }}>현재 비밀번호</label><input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="비밀번호 입력" style={inputStyle} autoFocus /></div>}
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}><label style={{ fontSize:11, color:'#6b7280' }}>새 PIN 6자리</label><input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g,''))} placeholder="······" style={pinStyle} autoFocus={!!password} /></div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}><label style={{ fontSize:11, color:'#6b7280' }}>PIN 확인</label><input type="password" inputMode="numeric" maxLength={6} value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g,''))} onKeyDown={e => e.key==='Enter'&&handleSave()} placeholder="······" style={pinStyle} /></div>
          {error && <div style={{ fontSize:12, color:'#f87171' }}>{error}</div>}
        </div>
        <div style={{ padding:'12px 20px', background:dk?'#0d0d0d':'#f9fafb', display:'flex', justifyContent:'flex-end', gap:8, borderTop:`1px solid ${modalBdr}` }}>
          <button onClick={onDone} style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>나중에</button>
          <button onClick={handleSave} disabled={loading} style={{ fontSize:12, padding:'6px 16px', borderRadius:6, border:'none', background:loading?'#4c1d95':'#7c3aed', color:'#f0f0f0', cursor:loading?'not-allowed':'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" }}>{loading?'저장 중...':'PIN 저장'}</button>
        </div>
      </div>
    </div>
  )
}

// ── LoginScreen ───────────────────────────────────
function LoginScreen({ darkMode, setDarkMode, onLoginSuccess }) {
  const [tab, setTab] = useState('login')
  const [email, setEmail] = useState(() => localStorage.getItem('bd_email') || '')
  const [password, setPassword] = useState('')
  const [alias, setAlias] = useState('')
  const [aliasManuallyEdited, setAliasManuallyEdited] = useState(false)
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const savedEmail = localStorage.getItem('bd_email')
    const savedEnc = localStorage.getItem('bd_enc')
    if (savedEmail && savedEnc) setTab('pinlogin')
  }, [])

  const handleEmailChange = (v) => {
    setEmail(v)
    if (tab === 'signup' && !aliasManuallyEdited) setAlias(v.split('@')[0] || '')
  }

  const handleLogin = async () => {
    setLoading(true); setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    localStorage.setItem('bd_email', email)
    onLoginSuccess(password)
    setLoading(false)
  }

  const handleSignup = async () => {
    if (!alias.trim()) { setError('얼라이어스를 입력해주세요'); return }
    setLoading(true); setError(null)
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { alias: alias.trim() } } })
    if (error) { setError(error.message); setLoading(false); return }
    if (data?.user?.id) await supabase.from('users').insert({ id: data.user.id, alias: alias.trim(), email })
    localStorage.setItem('bd_email', email)
    onLoginSuccess(password)
    setLoading(false)
  }

  const handlePinLogin = async () => {
    if (pin.length !== 6) { setError('PIN 6자리를 입력해주세요'); return }
    setLoading(true); setError(null)
    const { data: userData } = await supabase.from('users').select('pin_hash').eq('email', email).single()
    if (!userData?.pin_hash) { setError('PIN이 등록되지 않았어요'); setLoading(false); return }
    const hash = await hashPin(pin)
    if (hash !== userData.pin_hash) { setError('PIN이 틀렸어요'); setPin(''); setLoading(false); return }
    const savedEnc = localStorage.getItem('bd_enc')
    const pw = await decryptPw(pin, savedEnc)
    if (!pw) { setError('저장된 인증 정보가 없어요. 이메일/비밀번호로 다시 로그인해주세요'); setLoading(false); setTab('login'); return }
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    if (error) { setError('자동 로그인 실패. 이메일/비밀번호로 로그인해주세요'); setTab('login'); setLoading(false); return }
    setLoading(false)
  }

  const dk = darkMode
  const bg = dk?'#0d0d0d':'#f9fafb'; const cardBg = dk?'#111111':'#ffffff'; const cardBdr = dk?'#1f1f1f':'#e5e7eb'
  const accent = dk?'#a78bfa':'#7c3aed'; const lblClr = '#6b7280'
  const inputStyle = { fontSize:13, padding:'9px 11px', borderRadius:8, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:dk?'#1a1a1a':'#f3f4f6', color:dk?'#f0f0f0':'#111827', outline:'none', fontFamily:"'Geist', sans-serif", width:'100%', boxSizing:'border-box' }
  const pinStyle = { ...inputStyle, fontSize:24, letterSpacing:10, textAlign:'center', fontWeight:500 }
  const btnStyle = (disabled) => ({ fontSize:13, padding:'10px', borderRadius:8, border:'none', background:disabled?'#4c1d95':'#7c3aed', color:'#ffffff', cursor:disabled?'not-allowed':'pointer', fontWeight:500, marginTop:4, fontFamily:"'Geist', sans-serif", width:'100%' })
  const ghostBtn = { fontSize:12, background:'transparent', border:'none', color:lblClr, cursor:'pointer', fontFamily:"'Geist', sans-serif", textAlign:'center', width:'100%', padding:'4px 0' }

  return (
    <div style={{ minHeight:'100vh', background:bg, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Geist', sans-serif" }}>
      <div style={{ background:cardBg, border:`1px solid ${cardBdr}`, borderRadius:14, padding:'36px 32px', width:360, display:'flex', flexDirection:'column', gap:16 }}>
        <div style={{ display:'flex', justifyContent:'flex-end' }}>
          <button onClick={() => setDarkMode(d => !d)} style={{ fontSize:11, padding:'3px 10px', borderRadius:5, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:lblClr, cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>{dk?'☀️ 라이트':'🌙 다크'}</button>
        </div>
        <div style={{ fontSize:20, fontWeight:600, color:dk?'#f0f0f0':'#111827', marginBottom:6, display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:26, height:26, borderRadius:7, background:'linear-gradient(135deg,#175BFF,#8A2BFF)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <span style={{ fontSize:11, fontWeight:700, color:'white', letterSpacing:'-0.5px' }}>BD</span>
          </div>
          Sales<span style={{ color:accent }}>Gear</span>
        </div>
        <img src="/logo.svg" alt="" style={{ width:180, height:180, display:'block', margin:'0 auto 8px' }} />

        {tab === 'pinlogin' && <>
          <div style={{ fontSize:13, fontWeight:500, color:accent }}>안녕하세요 👋</div>
          <div style={{ fontSize:12, color:lblClr }}>{email}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}><label style={{ fontSize:11, color:lblClr }}>PIN 6자리</label><input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g,''))} onKeyDown={e => e.key==='Enter'&&handlePinLogin()} placeholder="······" style={pinStyle} autoFocus /></div>
          {error && <div style={{ fontSize:12, color:'#f87171' }}>{error}</div>}
          <button onClick={handlePinLogin} disabled={loading} style={btnStyle(loading)}>{loading?'확인 중...':'입장'}</button>
          <button onClick={() => { setTab('login'); setPin('') }} style={ghostBtn}>이메일/비밀번호로 로그인</button>
        </>}

        {(tab === 'login' || tab === 'signup') && <>
          <div style={{ display:'flex', borderBottom:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, marginBottom:4 }}>
            {[['login','로그인'],['signup','회원가입']].map(([t,label]) => (
              <button key={t} onClick={() => { setTab(t); setError(null) }} style={{ flex:1, fontSize:13, padding:'8px 0', border:'none', background:'transparent', color:tab===t?accent:'#6b7280', fontWeight:tab===t?600:400, borderBottom:tab===t?`2px solid ${accent}`:'2px solid transparent', cursor:'pointer', fontFamily:"'Geist', sans-serif", marginBottom:-1 }}>{label}</button>
            ))}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}><label style={{ fontSize:11, color:lblClr }}>이메일</label><input type="email" value={email} onChange={e => handleEmailChange(e.target.value)} onKeyDown={e => e.key==='Enter'&&(tab==='login'?handleLogin():handleSignup())} placeholder="name@company.com" style={inputStyle} /></div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}><label style={{ fontSize:11, color:lblClr }}>비밀번호</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key==='Enter'&&(tab==='login'?handleLogin():handleSignup())} placeholder="••••••••" style={inputStyle} /></div>
          {tab === 'signup' && (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <label style={{ fontSize:11, color:lblClr }}>얼라이어스 <span style={{ color:accent }}>*</span></label>
              <input type="text" value={alias} onChange={e => { setAlias(e.target.value); setAliasManuallyEdited(true) }} placeholder={email.split('@')[0]||'표시될 이름'} style={inputStyle} />
              <span style={{ fontSize:11, color:lblClr }}>담당자명으로 표시돼요 (예: jake, danny)</span>
            </div>
          )}
          {error && <div style={{ fontSize:12, color:'#f87171' }}>{error}</div>}
          <button onClick={tab==='login'?handleLogin:handleSignup} disabled={loading} style={btnStyle(loading)}>{loading?(tab==='login'?'입장 중...':'가입 중...'):(tab==='login'?'입장':'회원가입')}</button>
          {tab==='login' && localStorage.getItem('bd_enc') && <button onClick={() => { setTab('pinlogin'); setError(null) }} style={ghostBtn}>PIN으로 로그인</button>}
        </>}
      </div>
    </div>
  )
}
