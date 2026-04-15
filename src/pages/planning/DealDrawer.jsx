import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../../supabase'
import { getAlias, getWeekLabel, getPriorityGroup, PRIORITY_LABEL, STATUS_STYLE, OPP_STATUS_STYLE, OPP_STATUS_DB_TO_LABEL, OPP_STATUS_LABEL_TO_DB, OPP_STATUS_OPTIONS, fmtQuarter, COUNTRY_OPTIONS } from './constants'

// ─────────────────────────────────────────────────────
// 공용 DealDrawer
// Props:
//   item       : { type: 'deal'|'opp', data: {...} }
//   showDrop   : boolean (default true) — false면 드랍 버튼 숨김 (TeamOverview용)
// ─────────────────────────────────────────────────────
export default function DealDrawer({
  item, darkMode, session, fmtK, onClose,
  onPromote, onDrop, onPriorityChange,
  onRefreshDeals, onRefreshOpps,
  showDrop = true,
  productCats = [],
  quarters = [],
}) {
  const { type, data } = item
  const s  = useMemo(() => getDrawerStyles(darkMode), [darkMode])
  const dk = darkMode
  const br = dk ? '#1f1f1f' : '#e2e2e2'

  // ── 드래그 리사이즈 ──
  const [drawerWidth, setDrawerWidth] = useState(Math.max(480, window.innerWidth * 0.48))
  const isDragging = useRef(false)

  const handleResizeStart = useCallback((e) => {
    e.preventDefault()
    isDragging.current = true
    const startX = e.clientX
    const startW = drawerWidth

    const onMove = (e) => {
      if (!isDragging.current) return
      const delta = startX - e.clientX
      const newW = Math.min(Math.max(startW + delta, 380), window.innerWidth * 0.85)
      setDrawerWidth(newW)
    }
    const onUp = () => {
      isDragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [drawerWidth])

  const [comments, setComments]           = useState([])
  const [loadingC, setLoadingC]           = useState(true)
  const [commentOpen, setCommentOpen]     = useState(false)
  const [promoteOpen, setPromoteOpen]     = useState(false)
  const [editMode, setEditMode]           = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [saving, setSaving]               = useState(false)
  const [deleting, setDeleting]           = useState(false)

  const loadComments = async () => {
    setLoadingC(true)
    const { data: rows } = await supabase
      .from('timeline_comments')
      .select('*')
      .eq('entity_type', type)
      .eq('entity_id', data.id)
      .order('created_at', { ascending: false })
    setComments(rows || [])
    setLoadingC(false)
  }

  useEffect(() => { loadComments() }, [data.id, type])

  const grouped = comments.reduce((acc, c) => {
    const w = c.week_label || '—'
    if (!acc[w]) acc[w] = []
    acc[w].push(c)
    return acc
  }, {})

  const handleSaveDeal = async (fields) => {
    setSaving(true)
    await supabase.from('projects').update(fields).eq('id', data.id)
    setSaving(false); setEditMode(false)
    if (onRefreshDeals) onRefreshDeals()
  }

  const handleSaveOpp = async (fields) => {
    setSaving(true)
    await supabase.from('opportunities').update(fields).eq('id', data.id)
    setSaving(false); setEditMode(false)
    if (onRefreshOpps) onRefreshOpps()
  }

  const handleDelete = async () => {
    setDeleting(true)
    if (type === 'deal') await supabase.from('projects').update({ is_simulation: true }).eq('id', data.id)
    else await supabase.from('opportunities').update({ is_active: false }).eq('id', data.id)
    setDeleting(false)
    if (type === 'deal' && onRefreshDeals) onRefreshDeals()
    if (type === 'opp'  && onRefreshOpps)  onRefreshOpps()
    onClose()
  }

  return (
    <>
      <div style={{ position:'fixed', inset:0, zIndex:200 }} onClick={onClose} />
      <div style={{ ...s.panel, width: drawerWidth }}>

        {/* ── 드래그 핸들 ── */}
        <div
          onMouseDown={handleResizeStart}
          style={{
            position:'absolute', top:0, left:0, bottom:0, width:4,
            cursor:'col-resize', zIndex:10,
            background:'transparent',
            transition:'background .15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = dk?'rgba(124,58,237,0.3)':'rgba(124,58,237,0.2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        />

        {/* ── 헤더 ── */}
        <div style={s.header}>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={s.headerTitle}>{type === 'deal' ? data.case_name : data.title}</p>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginTop:6 }}>
              {type === 'deal' ? (
                <>
                  <StatusBadge status={data.status} />
                  <span style={s.headerMeta}>{data.customer} · {fmtK(data.book_amount)} · {fmtQuarter(data.quarter)} · {data.created_by}</span>
                </>
              ) : (
                <>
                  <OppStatusBadge status={data.status} />
                  <PriorityBadge priority={data.priority} />
                  <span style={s.headerMeta}>{data.customer} · {fmtK(data.amount)} · {data.owner}</span>
                </>
              )}
            </div>
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center', marginLeft:12, flexShrink:0 }}>
            {type === 'opp' && (
              <>
                <button style={s.btnPromote} onClick={() => setPromoteOpen(true)}>↑ 계약 건 승격</button>
                {showDrop && (
                  <button style={s.btnDrop} onClick={() => onDrop && onDrop(data.id)}>드랍</button>
                )}
              </>
            )}
            <button style={s.btnClose} onClick={onClose}>×</button>
          </div>
        </div>

        {/* ── 딜 상세 정보 + 수정/삭제 ── */}
        <div style={{ ...s.infoRow, justifyContent:'space-between' }}>
          <div style={{ display:'flex', gap:20, flexWrap:'wrap' }}>
            {type === 'deal' ? (
              <>
                <InfoChip label="제품" value={data.product_cat} />
                <InfoChip label="국가" value={data.country} />
                <InfoChip label="착수" value={data.start_month} />
                <InfoChip label="종료" value={data.end_month} />
                <InfoChip label="확도" value={`${data.probability || 0}%`} />
              </>
            ) : (
              <>
                <InfoChip label="제품" value={data.product} />
                <InfoChip label="통화" value={data.currency} />
                <InfoChip label="예상월" value={data.expected_date} />
                <InfoChip label="확도" value={`${data.confidence || 0}%`} />
              </>
            )}
          </div>
          {/* 수정 / 삭제 — 작게 오른쪽 끝 */}
          <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0, alignSelf: 'center' }}>
            <button
              style={{ fontSize:11, padding:'1px 8px', borderRadius:4, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:editMode?(dk?'#1e1635':'#ede9fe'):'transparent', color:editMode?'#7c3aed':(dk?'#9ca3af':'#6b7280'), cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
              onClick={() => { setEditMode(e => !e); setDeleteConfirm(false) }}>
              편집
            </button>
            {!deleteConfirm ? (
              <button
                style={{ fontSize:11, padding:'1px 8px', borderRadius:4, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#f87171', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                onClick={() => { setDeleteConfirm(true); setEditMode(false) }}>
                삭제
              </button>
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ fontSize:10, color:'#f87171' }}>삭제?</span>
                <button style={{ fontSize:10, padding:'1px 6px', borderRadius:4, border:'none', background:'#dc2626', color:'#fff', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                  onClick={handleDelete} disabled={deleting}>{deleting?'...':'확인'}</button>
                <button style={{ fontSize:10, padding:'1px 6px', borderRadius:4, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                  onClick={() => setDeleteConfirm(false)}>취소</button>
              </div>
            )}
          </div>
        </div>

        {/* ── 편집 폼 ── */}
        {editMode && (
          <div style={{ flexShrink:0, borderBottom:`1px solid ${br}`, overflowY:'auto', maxHeight:'55%' }}>
            {type === 'deal'
              ? <DealEditForm deal={data} darkMode={dk} fmtK={fmtK} saving={saving} productCats={productCats} quarters={quarters} onSave={handleSaveDeal} onCancel={() => setEditMode(false)} />
              : <OppEditForm  opp={data}  darkMode={dk} saving={saving} productCats={productCats} onSave={handleSaveOpp}  onCancel={() => setEditMode(false)} />
            }
          </div>
        )}

        {/* ── 타임라인 ── */}
        <div style={s.timeline}>
          <p style={s.timelineLabel}>타임라인</p>
          {loadingC ? (
            <p style={s.emptyText}>로딩 중...</p>
          ) : comments.length === 0 ? (
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <p style={{ ...s.emptyText, margin:0 }}>아직 기록이 없어요.</p>
              <button
                style={{ width:22, height:22, borderRadius:5, border:`1px solid ${br}`, background:'transparent', color:dk?'#6b7280':'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif", fontSize:16, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center', padding:0 }}
                onClick={() => setCommentOpen(true)}>+</button>
            </div>
          ) : (
            Object.entries(grouped).map(([week, items]) => (
              <WeekGroup key={week} week={week} items={items} darkMode={darkMode} session={session} onRefresh={loadComments} onAddComment={() => setCommentOpen(true)} />
            ))
          )}
        </div>
      </div>

      {/* ── 코멘트 모달 ── */}
      {commentOpen && (
        <CommentModal
          entityType={type} entityId={data.id}
          isOpp={type==='opp'} currentPriority={data.priority}
          darkMode={dk} session={session}
          onClose={() => setCommentOpen(false)}
          onSaved={() => { setCommentOpen(false); loadComments(); if (type==='opp' && onRefreshOpps) onRefreshOpps() }}
          onPriorityChange={onPriorityChange}
        />
      )}

      {/* ── 승격 모달 ── */}
      {promoteOpen && (
        <PromoteModal
          opp={data} darkMode={dk} session={session}
          onClose={() => setPromoteOpen(false)}
          onSaved={() => {
            setPromoteOpen(false)
            onClose()
            if (onRefreshDeals) onRefreshDeals()
            if (onRefreshOpps)  onRefreshOpps()
          }}
        />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────
// ProductCatSelect — 드롭다운 + 기타 직접 입력
// ─────────────────────────────────────────────────────
export function ProductCatSelect({ value, onChange, productCats = [], inp, darkMode }) {
  const isOther = value && !productCats.includes(value)
  const [showInput, setShowInput] = useState(isOther)
  const dk = darkMode

  const handleSelect = (e) => {
    const v = e.target.value
    if (v === '__other__') { setShowInput(true); onChange('') }
    else { setShowInput(false); onChange(v) }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
      <select style={inp} value={showInput ? '__other__' : (value || '')} onChange={handleSelect}>
        <option value="">선택</option>
        {productCats.map(c => <option key={c} value={c}>{c}</option>)}
        <option value="__other__">기타 (직접 입력)</option>
      </select>
      {showInput && (
        <input
          style={{ ...inp, marginTop:2 }}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="제품구분 입력"
          autoFocus
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// PromoteModal
// ─────────────────────────────────────────────────────
function PromoteModal({ opp, darkMode, session, onClose, onSaved }) {
  const dk = darkMode
  const [caseName, setCaseName]           = useState(opp.title || '')
  const [customer, setCustomer]           = useState(opp.customer || '')
  const [country, setCountry]             = useState('')
  const [productCat, setProductCat]       = useState(opp.product || '')
  const [quarter, setQuarter]             = useState('')
  const [contractMonth, setContractMonth] = useState(opp.expected_date || '')
  const [amt, setAmt]                     = useState(opp.amount || 0)
  const [conf, setConf]                   = useState(opp.confidence || 0)
  const [startMonth, setStartMonth]       = useState('')
  const [endMonth, setEndMonth]           = useState('')
  const [comment, setComment]             = useState('')
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState(null)
  const reflect = Math.round(amt * conf / 100)
  const QUARTERS = ['2025-Q1','2025-Q2','2025-Q3','2025-Q4','2026-Q1','2026-Q2','2026-Q3','2026-Q4','2027-Q1','2027-Q2']

  const handleSave = async () => {
    if (!caseName.trim())  { setError('프로젝트명을 입력해주세요'); return }
    if (!customer.trim())  { setError('고객사를 입력해주세요'); return }
    if (!productCat.trim()){ setError('제품구분을 입력해주세요'); return }
    if (!quarter)          { setError('분기를 선택해주세요'); return }
    if (!amt)              { setError('계약금액을 입력해주세요'); return }
    if (!startMonth)       { setError('착수월을 입력해주세요'); return }
    if (!endMonth)         { setError('종료월을 입력해주세요'); return }
    setSaving(true); setError(null)
    const { error: insertErr } = await supabase.from('projects').insert({
      case_name: caseName.trim(), customer: customer.trim(),
      product_cat: productCat.trim(), country: country.trim(),
      quarter, contract_month: contractMonth || null,
      book_amount: amt, probability: conf,
      start_month: startMonth, end_month: endMonth,
      comment, created_by: getAlias(session),
      status: 'active', is_simulation: false,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    if (insertErr) { setError(insertErr.message); setSaving(false); return }
    await supabase.from('opportunities').update({ status: 'Promoted', is_active: false }).eq('id', opp.id)
    setSaving(false); onSaved()
  }

  const bg  = dk?'#111':'#fff', br = dk?'#2a1f5c':'#e5e7eb'
  const inp = { fontSize:12, padding:'7px 9px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:dk?'#1a1a1a':'#f9fafb', color:dk?'#f0f0f0':'#111827', fontFamily:"'Geist', sans-serif", outline:'none', width:'100%', boxSizing:'border-box' }
  const lbl = { fontSize:11, color:'#6b7280', marginBottom:3, display:'block' }
  const field = { display:'flex', flexDirection:'column', gap:3 }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:400, padding:20 }}>
      <div style={{ background:bg, border:`1px solid ${br}`, borderRadius:12, width:'100%', maxWidth:600, overflow:'hidden', fontFamily:"'Geist', sans-serif" }}>
        <div style={{ background:dk?'#1e1635':'#f5f3ff', padding:'13px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:`1px solid ${br}` }}>
          <div>
            <span style={{ fontSize:13, fontWeight:500, color:dk?'#c4b5fd':'#5b21b6' }}>↑ 계약 건 승격</span>
            <span style={{ fontSize:11, color:'#6b7280', marginLeft:8 }}>"{opp.title}" → 계약 건으로 등록</span>
          </div>
          <button onClick={onClose} style={{ fontSize:20, color:'#7c3aed', background:'none', border:'none', cursor:'pointer', lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:'20px', display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', gap:10 }}>
            <div style={field}><label style={lbl}>프로젝트명 *</label><input style={inp} value={caseName} onChange={e => setCaseName(e.target.value)} /></div>
            <div style={field}><label style={lbl}>고객사</label><input style={inp} value={customer} onChange={e => setCustomer(e.target.value)} /></div>
            <div style={field}><label style={lbl}>국가</label><select style={inp} value={country} onChange={e => setCountry(e.target.value)}><option value="">선택</option>{COUNTRY_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select></div>
            <div style={field}><label style={lbl}>제품구분</label><ProductCatSelect value={productCat} onChange={setProductCat} productCats={productCats} inp={inp} darkMode={dk} /></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr', gap:10 }}>
            <div style={field}>
              <label style={lbl}>분기 *</label>
              <select style={inp} value={quarter} onChange={e => setQuarter(e.target.value)}>
                <option value="">선택</option>
                {QUARTERS.map(q => <option key={q} value={q}>{fmtQuarter(q)}</option>)}
              </select>
            </div>
            <div style={field}><label style={lbl}>예상 계약월</label><input style={inp} type="month" value={contractMonth} onChange={e => setContractMonth(e.target.value)} /></div>
            <div style={field}><label style={lbl}>확도 (%)</label><input style={inp} type="number" min={0} max={100} value={conf} onChange={e => setConf(Number(e.target.value))} /></div>
            <div style={field}><label style={lbl}>계약금액 (K)</label><input style={inp} type="number" step={1000} value={amt} onChange={e => setAmt(Number(e.target.value))} /></div>
            <div style={field}><label style={lbl}>반영금액</label><input style={{...inp, color:'#6b7280'}} value={reflect.toLocaleString()+' K'} readOnly /></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 2fr', gap:10 }}>
            <div style={field}><label style={lbl}>착수월</label><input style={inp} type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} /></div>
            <div style={field}><label style={lbl}>종료월</label><input style={inp} type="month" value={endMonth} onChange={e => setEndMonth(e.target.value)} /></div>
            <div style={field}><label style={lbl}>코멘트</label><input style={inp} value={comment} onChange={e => setComment(e.target.value)} placeholder="승격 메모 (선택)" /></div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', borderRadius:6, background:dk?'#0f1a0f':'#f0fdf4', border:`1px solid ${dk?'#1a3a1a':'#bbf7d0'}` }}>
            <div style={{ width:6, height:6, borderRadius:'50%', background:'#4ade80', flexShrink:0 }} />
            <span style={{ fontSize:11, color:dk?'#4ade80':'#16a34a' }}>승격 후 기본 상태: <strong>진행중</strong> — 이후 수정에서 계약 상태로 변경할 수 있어요</span>
          </div>
          {error && <div style={{ fontSize:12, color:'#f87171' }}>{error}</div>}
        </div>
        <div style={{ padding:'12px 20px', background:dk?'#0d0d0d':'#f9fafb', display:'flex', justifyContent:'flex-end', gap:8, borderTop:`1px solid ${br}` }}>
          <button onClick={onClose} style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{ fontSize:12, padding:'6px 18px', borderRadius:6, border:'none', background:saving?'#4c1d95':'#7c3aed', color:'#f0f0f0', cursor:saving?'not-allowed':'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" }}>{saving?'저장 중...':'↑ 승격'}</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────
// DealEditForm
// ─────────────────────────────────────────────────────
function DealEditForm({ deal, darkMode, fmtK, saving, onSave, onCancel, productCats = [], quarters = [] }) {
  const [caseName, setCaseName]           = useState(deal.case_name || '')
  const [customer, setCustomer]           = useState(deal.customer || '')
  const [country, setCountry]             = useState(deal.country || 'KR')
  const [productCat, setProductCat]       = useState(deal.product_cat || '')
  const [quarter, setQuarter]             = useState(deal.quarter || '')
  const [contractMonth, setContractMonth] = useState(deal.contract_month || '')
  const [amt, setAmt]                     = useState(deal.book_amount || 0)
  const [conf, setConf]                   = useState(deal.probability || 0)
  const [startMonth, setStartMonth]       = useState(deal.start_month || '')
  const [endMonth, setEndMonth]           = useState(deal.end_month || '')
  const [status, setStatus]               = useState(deal.status || 'active')
  const [comment, setComment]             = useState(deal.comment || '')
  const [formError, setFormError]         = useState(null)
  const reflect = Math.round(amt * conf / 100)
  const dk = darkMode
  const bg = dk?'#0d0d12':'#f8f7ff', br = dk?'#2a1f5c':'#e0dff8'
  const inp = { fontSize:12, padding:'7px 9px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#d1d5db'}`, background:dk?'#111':'#fff', color:dk?'#f0f0f0':'#111', fontFamily:"'Geist', sans-serif", outline:'none', width:'100%', boxSizing:'border-box' }
  const lbl = { fontSize:11, color:'#6b7280', marginBottom:3, display:'block' }
  const field = { display:'flex', flexDirection:'column', gap:3 }
  const STATUS_OPTS = [['active','진행중','#60a5fa'],['won','계약','#4ade80'],['drop','드랍','#f87171'],['pending','대기','#fbbf24']]

  const handleSave = () => {
    if (!caseName.trim())  { setFormError('프로젝트명을 입력해주세요'); return }
    if (!customer.trim())  { setFormError('고객사를 입력해주세요'); return }
    if (!country.trim())   { setFormError('국가를 입력해주세요'); return }
    if (!productCat.trim()){ setFormError('제품구분을 선택해주세요'); return }
    if (!quarter)          { setFormError('분기를 선택해주세요'); return }
    if (!amt)              { setFormError('계약금액을 입력해주세요'); return }
    if (!startMonth)       { setFormError('착수월을 입력해주세요'); return }
    if (!endMonth)         { setFormError('종료월을 입력해주세요'); return }
    setFormError(null)
    onSave({
      case_name: caseName.trim(), customer: customer.trim(), country: country.trim(),
      product_cat: productCat.trim(), quarter,
      contract_month: contractMonth || null,
      book_amount: amt, probability: conf,
      start_month: startMonth, end_month: endMonth,
      status, comment,
    })
  }

  return (
    <div style={{ background:bg, padding:'16px 20px', borderTop:`1px solid ${br}` }}>
      <p style={{ fontSize:11, fontWeight:500, color:'#7c3aed', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.04em' }}>✏️ 계약 건 수정</p>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:10, marginBottom:10 }}>
        <div style={{ ...field, gridColumn:'span 2' }}><label style={lbl}>프로젝트명</label><input style={inp} value={caseName} onChange={e => setCaseName(e.target.value)} /></div>
        <div style={field}><label style={lbl}>고객사</label><input style={inp} value={customer} onChange={e => setCustomer(e.target.value)} /></div>
        <div style={field}><label style={lbl}>국가</label><select style={inp} value={country} onChange={e => setCountry(e.target.value)}><option value="">선택</option>{COUNTRY_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select></div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:10, marginBottom:10 }}>
        <div style={field}><label style={lbl}>제품구분</label><ProductCatSelect value={productCat} onChange={setProductCat} productCats={productCats} inp={inp} darkMode={dk} /></div>
        <div style={field}><label style={lbl}>분기</label>
          <select style={inp} value={quarter} onChange={e => setQuarter(e.target.value)}>
            <option value="">선택</option>
            {[...new Set([...quarters, '2025-Q1','2025-Q2','2025-Q3','2025-Q4','2026-Q1','2026-Q2','2026-Q3','2026-Q4','2027-Q1','2027-Q2'])].sort().map(q => <option key={q} value={q}>{fmtQuarter(q)}</option>)}
          </select>
        </div>
        <div style={field}><label style={lbl}>예상 계약월</label><input style={inp} type="month" value={contractMonth} onChange={e => setContractMonth(e.target.value)} /></div>
        <div style={field}><label style={lbl}>확도 (%)</label><input style={inp} type="number" min={0} max={100} value={conf} onChange={e => setConf(Number(e.target.value))} /></div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:10, marginBottom:10 }}>
        <div style={field}>
          <label style={lbl}>계약금액 (K KRW)</label>
          <input style={inp} type="number" value={amt} step={1000} onChange={e => setAmt(Number(e.target.value))} />
          <span style={{ fontSize:11, color:'#6b7280' }}>반영: {fmtK(reflect)}</span>
        </div>
        <div style={field}><label style={lbl}>착수월</label><input style={inp} type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} /></div>
        <div style={field}><label style={lbl}>종료월</label><input style={inp} type="month" value={endMonth} onChange={e => setEndMonth(e.target.value)} /></div>
        <div style={field}>
          <label style={lbl}>상태</label>
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {STATUS_OPTS.map(([val, label, color]) => (
              <button key={val} style={{ fontSize:11, padding:'3px 8px', borderRadius:5, border:`1px solid ${status===val?color:dk?'#2a2a2a':'#d1d5db'}`, background:status===val?color+'18':'transparent', color:status===val?color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                onClick={() => setStatus(val)}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginBottom:12 }}>
        <label style={lbl}>코멘트</label>
        <textarea rows={2} style={{ ...inp, resize:'vertical', minHeight:48, lineHeight:1.6 }} value={comment} onChange={e => setComment(e.target.value)} />
      </div>
      {formError && <div style={{ fontSize:11, color:'#f87171', marginBottom:8 }}>{formError}</div>}
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
        <button onClick={onCancel} style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>취소</button>
        <button onClick={handleSave} disabled={saving} style={{ fontSize:12, padding:'6px 18px', borderRadius:6, border:'none', background:saving?'#4c1d95':'#7c3aed', color:'#f0f0f0', cursor:saving?'not-allowed':'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" }}>{saving?'저장 중...':'저장'}</button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────
// OppEditForm
// ─────────────────────────────────────────────────────
function OppEditForm({ opp, darkMode, saving, onSave, onCancel, productCats = [] }) {
  const [title, setTitle]               = useState(opp.title || '')
  const [customer, setCustomer]         = useState(opp.customer || '')
  const [product, setProduct]           = useState(opp.product || '')
  const [currency, setCurrency]         = useState(opp.currency || 'KRW')
  const [amount, setAmount]             = useState(opp.amount || 0)
  const [expectedDate, setExpectedDate] = useState(opp.expected_date || '')
  const [confidence, setConfidence]     = useState(opp.confidence || 0)
  const [statusLabel, setStatusLabel]   = useState(OPP_STATUS_DB_TO_LABEL[opp.status] || '기획 중')
  const [priority, setPriority]         = useState(opp.priority || 5)
  const [formError, setFormError]       = useState(null)
  const dk = darkMode
  const bg = dk?'#0d0d12':'#f8f7ff', br = dk?'#2a1f5c':'#e0dff8'
  const inp = { fontSize:12, padding:'7px 9px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#d1d5db'}`, background:dk?'#111':'#fff', color:dk?'#f0f0f0':'#111', fontFamily:"'Geist', sans-serif", outline:'none', width:'100%', boxSizing:'border-box' }
  const lbl = { fontSize:11, color:'#6b7280', marginBottom:3, display:'block' }
  const field = { display:'flex', flexDirection:'column', gap:3 }
  const PRIORITY_OPTS = [
    { val:'high', range:[1,3], label:'HIGH', color:'#D85A30', bg:'#FAECE7' },
    { val:'mid',  range:[4,6], label:'MID',  color:'#BA7517', bg:'#FAEEDA' },
    { val:'low',  range:[7,9], label:'LOW',  color:'#639922', bg:'#EAF3DE' },
  ]
  const currentGroup = priority <= 3 ? 'high' : priority <= 6 ? 'mid' : 'low'

  const handleSave = () => {
    if (!title.trim())        { setFormError('프로젝트명을 입력해주세요'); return }
    if (!customer.trim())     { setFormError('고객사를 입력해주세요'); return }
    if (!product.trim())      { setFormError('제품구분을 선택해주세요'); return }
    if (!amount)              { setFormError('예상금액을 입력해주세요'); return }
    if (!expectedDate)        { setFormError('예상 계약월을 입력해주세요'); return }
    setFormError(null)
    onSave({
      title: title.trim(), customer: customer.trim(), product: product.trim(),
      currency, amount, expected_date: expectedDate,
      confidence,
      status: OPP_STATUS_LABEL_TO_DB[statusLabel] || 'Idea',
      priority,
    })
  }

  return (
    <div style={{ background:bg, padding:'16px 20px', borderTop:`1px solid ${br}` }}>
      <p style={{ fontSize:11, fontWeight:500, color:'#7c3aed', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.04em' }}>✏️ 사업 기회 수정</p>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:10, marginBottom:10 }}>
        <div style={{ ...field, gridColumn:'span 2' }}><label style={lbl}>프로젝트명</label><input style={inp} value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div style={field}><label style={lbl}>고객사</label><input style={inp} value={customer} onChange={e => setCustomer(e.target.value)} /></div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:10, marginBottom:10 }}>
        <div style={field}><label style={lbl}>제품구분</label><ProductCatSelect value={product} onChange={setProduct} productCats={productCats} inp={inp} darkMode={dk} /></div>
        <div style={field}><label style={lbl}>통화</label>
          <select style={inp} value={currency} onChange={e => setCurrency(e.target.value)}>
            {['KRW','USD','CNY','JPY','EUR'].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={field}><label style={lbl}>예상 금액 (K)</label><input style={inp} type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} /></div>
        <div style={field}><label style={lbl}>예상 계약월</label><input style={inp} type="month" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} /></div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
        <div style={field}>
          <label style={lbl}>상태</label>
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {OPP_STATUS_OPTIONS.map(v => (
              <button key={v} style={{ fontSize:11, padding:'3px 8px', borderRadius:5, border:`1px solid ${statusLabel===v?'#7c3aed':dk?'#2a2a2a':'#d1d5db'}`, background:statusLabel===v?'rgba(124,58,237,0.1)':'transparent', color:statusLabel===v?'#7c3aed':'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                onClick={() => setStatusLabel(v)}>{v}</button>
            ))}
          </div>
        </div>
        <div style={field}><label style={lbl}>확도 (%)</label><input style={inp} type="number" min={0} max={100} value={confidence} onChange={e => setConfidence(Number(e.target.value))} /></div>
      </div>
      <div style={{ marginBottom:12 }}>
        <label style={lbl}>중요도</label>
        <div style={{ display:'flex', gap:8 }}>
          {PRIORITY_OPTS.map(({ val, range, label, color, bg: pbg }) => (
            <button key={val} style={{ fontSize:12, padding:'5px 18px', borderRadius:99, border:`1.5px solid ${currentGroup===val?color:dk?'#2a2a2a':'#d1d5db'}`, background:currentGroup===val?pbg:'transparent', color:currentGroup===val?color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif", fontWeight:currentGroup===val?500:400 }}
              onClick={() => setPriority(range[0])}>{label}</button>
          ))}
        </div>
      </div>
      {formError && <div style={{ fontSize:11, color:'#f87171', marginBottom:8 }}>{formError}</div>}
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
        <button onClick={onCancel} style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>취소</button>
        <button onClick={handleSave} disabled={saving} style={{ fontSize:12, padding:'6px 18px', borderRadius:6, border:'none', background:saving?'#4c1d95':'#7c3aed', color:'#f0f0f0', cursor:saving?'not-allowed':'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" }}>{saving?'저장 중...':'저장'}</button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────
// WeekGroup
// ─────────────────────────────────────────────────────
function WeekGroup({ week, items, darkMode, session, onRefresh, onAddComment }) {
  const [showRaw, setShowRaw]     = useState(false)
  const [editingId, setEditingId] = useState(null)
  const s       = useMemo(() => getDrawerStyles(darkMode), [darkMode])
  const myAlias = getAlias(session)

  return (
    <div style={{ marginBottom:22 }}>
      <div style={s.weekHeader}>
        <span style={s.weekBadge}>{week}</span>
        <div style={s.weekLine} />
        <div style={s.aiBox}>
          <span style={{ fontSize:13 }}>✦</span>
          <span style={s.aiText}>{items[0]?.content_summary || 'AI 요약 준비 중'}</span>
          <button style={s.rawBtn} onClick={() => setShowRaw(v => !v)}>
            {showRaw ? '요약보기' : '원본보기'}
          </button>
        </div>
        <div style={s.weekLine} />
        <button
          onClick={onAddComment}
          title="코멘트 추가"
          style={{ width:20, height:20, borderRadius:4, border:`1px solid ${darkMode?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:darkMode?'#6b7280':'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif", fontSize:14, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center', padding:0, flexShrink:0 }}>
          +
        </button>
      </div>
      {items.map((item, i) => {
        const isOwn = item.author === myAlias
        const isEditing = editingId === item.id
        return (
          <div key={item.id} style={{ display:'flex', gap:10, paddingBottom: i < items.length-1 ? 14 : 0 }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', width:12, flexShrink:0 }}>
              <div style={{ width:8, height:8, borderRadius:'50%', background: i===0?'#534AB7':darkMode?'#374151':'#d1d5db', flexShrink:0, marginTop:3 }} />
              {i < items.length-1 && <div style={{ width:1, flex:1, background:darkMode?'#1f1f1f':'#e2e2e2', minHeight:20 }} />}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
                <span style={s.dateLabel}>
                  {new Date(item.created_at).toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit' })}
                  <span style={s.timeLabel}>{' '}{new Date(item.created_at).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' })}</span>
                  <span style={s.authorLabel}> · {item.author}</span>
                </span>
                <div style={{ display:'flex', gap:2, alignItems:'center' }}>
                  {/* ✏ 편집 */}
                  <IconBtn
                    title="편집"
                    active={isEditing}
                    darkMode={darkMode}
                    onClick={() => setEditingId(isEditing ? null : item.id)}
                  >✏</IconBtn>
                  {/* 🗑 삭제 — 본인만 */}
                  {isOwn && <DeleteBtn itemId={item.id} darkMode={darkMode} onDeleted={onRefresh} />}
                </div>
              </div>
              {isEditing ? (
                <InlineEditor
                  item={item} darkMode={darkMode}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => { setEditingId(null); onRefresh() }}
                  onAiRequest={(text, cb) => {
                    // AI 정리 요청 — cb(result)로 텍스트 교체
                    fetch('https://api.anthropic.com/v1/messages', {
                      method:'POST', headers:{'Content-Type':'application/json'},
                      body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:200,
                        messages:[{ role:'user', content:`다음 영업 활동 기록을 2-3문장으로 간결하게 요약해줘. 구어체를 정제된 업무 문체로 바꿔줘:\n\n${text}` }] })
                    }).then(r => r.json()).then(d => cb(d.content?.[0]?.text || text)).catch(() => cb(text))
                  }}
                />
              ) : (
                <p style={s.commentText}>{showRaw ? item.content_raw : (item.content_summary || item.content_raw)}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// IconBtn — 아이콘 버튼 (평소 회색, active시 보라색)
// ─────────────────────────────────────────────────────
function IconBtn({ children, active, darkMode, onClick, title, style: extraStyle }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width:20, height:20, borderRadius:4, border:'none',
        background: active ? (darkMode?'#1e1635':'#ede9fe') : 'transparent',
        color: active ? '#7c3aed' : hover ? (darkMode?'#d1d5db':'#374151') : (darkMode?'#4b5563':'#9ca3af'),
        cursor:'pointer', fontFamily:"'Geist', sans-serif",
        fontSize:11, lineHeight:1,
        display:'flex', alignItems:'center', justifyContent:'center', padding:0,
        transition:'all .1s', flexShrink:0,
        ...extraStyle,
      }}
    >{children}</button>
  )
}

// ─────────────────────────────────────────────────────
// DeleteBtn (본인 코멘트만)
// ─────────────────────────────────────────────────────
function DeleteBtn({ itemId, darkMode, onDeleted }) {
  const [confirm, setConfirm]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const dk = darkMode
  if (confirm) return (
    <div style={{ display:'flex', alignItems:'center', gap:4 }}>
      <span style={{ fontSize:10, color:'#f87171' }}>삭제?</span>
      <button onClick={async () => { setDeleting(true); await supabase.from('timeline_comments').delete().eq('id', itemId); setDeleting(false); onDeleted() }}
        disabled={deleting}
        style={{ fontSize:10, padding:'1px 6px', borderRadius:4, border:'none', background:'#dc2626', color:'#fff', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>
        {deleting?'...':'확인'}
      </button>
      <button onClick={() => setConfirm(false)}
        style={{ fontSize:10, padding:'1px 6px', borderRadius:4, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>
        취소
      </button>
    </div>
  )
  return (
    <IconBtn title="삭제" active={false} darkMode={darkMode} onClick={() => setConfirm(true)}
      style={{ color:'#f87171' }}>🗑</IconBtn>
  )
}

// ─────────────────────────────────────────────────────
// InlineEditor
// ─────────────────────────────────────────────────────
function InlineEditor({ item, darkMode, onCancel, onSaved, onAiRequest }) {
  const [text, setText]         = useState(item.content_raw || '')
  const [saving, setSaving]     = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiActive, setAiActive] = useState(false)
  const dk = darkMode
  const inp = { fontSize:12, padding:'8px 10px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:dk?'#1a1a1a':'#f9fafb', color:dk?'#f0f0f0':'#111', fontFamily:"'Geist', sans-serif", outline:'none', width:'100%', boxSizing:'border-box', resize:'none', lineHeight:1.6 }

  const handleAI = () => {
    if (!text.trim() || aiLoading) return
    setAiLoading(true)
    onAiRequest && onAiRequest(text, (result) => {
      setText(result)
      setAiActive(true)
      setAiLoading(false)
    })
  }

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('timeline_comments').update({ content_raw: text, content_summary: null }).eq('id', item.id)
    setSaving(false); onSaved()
  }

  return (
    <div style={{ marginTop:4 }}>
      <textarea rows={3} style={inp} value={text} onChange={e => { setText(e.target.value); setAiActive(false) }} />
      <div style={{ display:'flex', gap:4, justifyContent:'flex-end', alignItems:'center', marginTop:4 }}>
        {/* ✦ AI 버튼 */}
        <button
          onClick={handleAI}
          disabled={aiLoading}
          title="AI 정리"
          style={{
            width:20, height:20, borderRadius:4, border:'none',
            background: aiActive ? (dk?'#1e1635':'#ede9fe') : 'transparent',
            color: aiActive ? '#7c3aed' : aiLoading ? '#7c3aed' : (dk?'#4b5563':'#9ca3af'),
            cursor: aiLoading ? 'not-allowed' : 'pointer',
            fontFamily:"'Geist', sans-serif", fontSize:11,
            display:'flex', alignItems:'center', justifyContent:'center', padding:0, flexShrink:0,
          }}>
          {aiLoading ? '…' : '✦'}
        </button>
        <div style={{ width:1, height:12, background:dk?'#2a2a2a':'#e5e7eb' }} />
        <button onClick={onCancel}
          style={{ fontSize:11, padding:'1px 8px', borderRadius:4, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:dk?'#6b7280':'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>
          취소
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ fontSize:11, padding:'1px 8px', borderRadius:4, border:'none', background:saving?'#4c1d95':'#7c3aed', color:'#f0f0f0', cursor:saving?'not-allowed':'pointer', fontFamily:"'Geist', sans-serif" }}>
          {saving?'...':'저장'}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────
// CommentModal (export — TeamOverview에서도 사용 가능)
// ─────────────────────────────────────────────────────
export function CommentModal({ entityType, entityId, isOpp, currentPriority, darkMode, session, onClose, onSaved, onPriorityChange }) {
  const [raw, setRaw]             = useState('')
  const [priority, setPriority]   = useState(currentPriority || 10)
  const [saving, setSaving]       = useState(false)
  const [aiPreview, setAiPreview] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const currentGroup = priority <= 3 ? 'high' : priority <= 6 ? 'mid' : 'low'
  const PRIORITY_OPTS = [
    { val:'high', range:[1,3], label:'HIGH', color:'#D85A30', bg:'#FAECE7' },
    { val:'mid',  range:[4,6], label:'MID',  color:'#BA7517', bg:'#FAEEDA' },
    { val:'low',  range:[7,9], label:'LOW',  color:'#639922', bg:'#EAF3DE' },
  ]

  const handleAI = async () => {
    if (!raw.trim()) return
    setAiLoading(true)
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:200,
          messages:[{ role:'user', content:`다음 영업 활동 기록을 2-3문장으로 간결하게 요약해줘. 구어체를 정제된 업무 문체로 바꿔줘:\n\n${raw}` }] })
      })
      const d = await res.json()
      setAiPreview(d.content?.[0]?.text || null)
    } catch { setAiPreview(null) }
    setAiLoading(false)
  }

  const handleSave = async () => {
    if (!raw.trim()) return
    setSaving(true)
    const alias = getAlias(session)
    await supabase.from('timeline_comments').insert({
      entity_type: entityType, entity_id: entityId, author: alias,
      content_raw: raw, content_summary: aiPreview || null,
      week_label: getWeekLabel(new Date()),
      comment_date: new Date().toISOString().split('T')[0],
    })
    if (isOpp && onPriorityChange) await onPriorityChange(entityId, priority)
    setSaving(false); onSaved()
  }

  const dk = darkMode
  const bg = dk?'#111':'#fff', br = dk?'#2a1f5c':'#e5e7eb', tx = dk?'#f0f0f0':'#111'
  const inp = { fontSize:13, padding:'10px 12px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:dk?'#1a1a1a':'#f9fafb', color:tx, fontFamily:"'Geist', sans-serif", outline:'none', width:'100%', boxSizing:'border-box', resize:'none', lineHeight:1.7 }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:20 }}>
      <div style={{ background:bg, border:`1px solid ${br}`, borderRadius:12, width:'100%', maxWidth:500, overflow:'hidden', fontFamily:"'Geist', sans-serif" }}>
        <div style={{ background:dk?'#1e1635':'#f5f3ff', padding:'13px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:`1px solid ${br}` }}>
          <span style={{ fontSize:13, fontWeight:500, color:dk?'#c4b5fd':'#5b21b6' }}>활동 기록 추가</span>
          <button onClick={onClose} style={{ fontSize:20, color:'#7c3aed', background:'none', border:'none', cursor:'pointer', lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:'18px 20px', display:'flex', flexDirection:'column', gap:14 }}>
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <label style={{ fontSize:11, color:'#6b7280', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.04em' }}>내용</label>
              <button style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, padding:'3px 10px', borderRadius:99, border:'1px solid #AFA9EC', background:'#EEEDFE', color:'#3C3489', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                onClick={handleAI} disabled={aiLoading}>
                <span style={{ fontSize:13 }}>✦</span>
                <span>{aiLoading?'AI 정리 중...':'AI로 정리'}</span>
              </button>
            </div>
            <textarea rows={4} style={inp}
              placeholder={'자유롭게 입력하세요. 구어체도 괜찮아요.\n예) 오늘 유플러스 담당자한테 연락했는데 투심이 2주 더 걸릴 것 같다고 함'}
              value={raw} onChange={e => setRaw(e.target.value)} />
            {aiPreview && (
              <div style={{ background:'#EEEDFE', border:'1px solid #AFA9EC', borderRadius:6, padding:'10px 12px', marginTop:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:5 }}>
                  <span style={{ fontSize:13 }}>✦</span>
                  <span style={{ fontSize:11, fontWeight:500, color:'#3C3489' }}>AI 요약 미리보기</span>
                  <button style={{ fontSize:11, padding:'1px 6px', borderRadius:4, border:'1px solid #AFA9EC', background:'transparent', color:'#534AB7', cursor:'pointer', marginLeft:'auto' }}
                    onClick={() => setAiPreview(null)}>원본으로 되돌리기</button>
                </div>
                <p style={{ fontSize:12, color:'#3C3489', lineHeight:1.6, margin:0 }}>{aiPreview}</p>
              </div>
            )}
          </div>
          {isOpp && (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                <label style={{ fontSize:11, color:'#6b7280', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.04em' }}>중요도 업데이트</label>
                <span style={{ fontSize:10, color:'#D85A30', fontWeight:500 }}>필수</span>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                {PRIORITY_OPTS.map(({ val, range, label, color, bg: pbg }) => (
                  <button key={val}
                    style={{ fontSize:12, padding:'6px 20px', borderRadius:99, border:`1.5px solid ${currentGroup===val?color:dk?'#2a2a2a':'#e5e7eb'}`, background:currentGroup===val?pbg:'transparent', color:currentGroup===val?color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif", fontWeight:currentGroup===val?500:400, transition:'all .15s' }}
                    onClick={() => setPriority(range[0])}>{label}</button>
                ))}
              </div>
              <p style={{ fontSize:11, color:'#6b7280', marginTop:6 }}>현재: {currentGroup.toUpperCase()} (우선순위 {priority}) — 저장 전 반드시 확인</p>
            </div>
          )}
        </div>
        <div style={{ padding:'12px 20px', borderTop:`1px solid ${br}`, display:'flex', justifyContent:'flex-end', gap:8, background:dk?'#0d0d0d':'#f9fafb' }}>
          <button onClick={onClose} style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>취소</button>
          <button onClick={handleSave} disabled={saving||!raw.trim()}
            style={{ fontSize:12, padding:'6px 18px', borderRadius:6, border:'none', background:saving||!raw.trim()?'#4c1d95':'#7c3aed', color:'#f0f0f0', cursor:saving||!raw.trim()?'not-allowed':'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" }}>
            {saving?'저장 중...':'저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────
// Export 서브 컴포넌트
// ─────────────────────────────────────────────────────
function InfoChip({ label, value }) {
  return value ? (
    <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
      <span style={{ fontSize:10, color:'#6b7280' }}>{label}</span>
      <span style={{ fontSize:12, color:'inherit' }}>{value}</span>
    </div>
  ) : null
}

export function StatusBadge({ status }) {
  const st = STATUS_STYLE[status] || STATUS_STYLE.active
  return <span style={{ display:'inline-block', fontSize:11, padding:'2px 7px', borderRadius:4, fontWeight:500, background:st.bg, color:st.color }}>{st.label}</span>
}

export function OppStatusBadge({ status }) {
  const st    = OPP_STATUS_STYLE[status] || OPP_STATUS_STYLE['Idea']
  const label = OPP_STATUS_DB_TO_LABEL[status] || status
  return <span style={{ display:'inline-block', fontSize:11, padding:'2px 7px', borderRadius:4, fontWeight:500, background:st.bg, color:st.color }}>{label}</span>
}

export function PriorityBadge({ priority }) {
  const group = getPriorityGroup(priority)
  const { label, color, bg } = PRIORITY_LABEL[group]
  return <span style={{ display:'inline-block', fontSize:11, padding:'2px 7px', borderRadius:4, fontWeight:500, background:bg, color }}>{label}</span>
}

export function ConfBar({ pct }) {
  const color = pct >= 100 ? '#4ade80' : pct >= 60 ? '#60a5fa' : pct >= 30 ? '#fbbf24' : '#4b5563'
  return (
    <div style={{ display:'flex', alignItems:'center', gap:5, justifyContent:'center' }}>
      <div style={{ width:40, height:3, background:'#d1d5db', borderRadius:2, overflow:'hidden' }}>
        <div style={{ width:Math.min(pct,100)+'%', height:'100%', background:color, borderRadius:2 }} />
      </div>
      <span style={{ fontSize:11, color:'#9ca3af' }}>{pct}%</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 스타일
// ─────────────────────────────────────────────────────
function getDrawerStyles(dark) {
  const br  = dark?'#1f1f1f':'#e2e2e2'
  const tx0 = dark?'#f0f0f0':'#111', tx1 = dark?'#6b7280':'#6b7280', tx2 = dark?'#d1d5db':'#374151'
  return {
    panel:         { position:'fixed', top:0, right:0, bottom:0, zIndex:201, minWidth:380, background:dark?'#111':'#fff', borderLeft:`1px solid ${br}`, display:'flex', flexDirection:'column', fontFamily:"'Geist', sans-serif", boxShadow:'-4px 0 24px rgba(0,0,0,0.12)' },
    header:        { padding:'14px 20px', borderBottom:`1px solid ${br}`, display:'flex', justifyContent:'space-between', alignItems:'flex-start' },
    headerTitle:   { fontSize:15, fontWeight:500, color:tx0 },
    headerMeta:    { fontSize:11, color:tx1 },
    infoRow:       { display:'flex', gap:20, padding:'10px 20px', borderBottom:`1px solid ${br}`, color:tx2, flexWrap:'wrap' },
    timeline:      { flex:1, overflowY:'auto', padding:'16px 20px' },
    timelineLabel: { fontSize:11, fontWeight:500, color:tx1, letterSpacing:'0.04em', textTransform:'uppercase', marginBottom:14 },
    emptyText:     { fontSize:12, color:tx1 },
    weekHeader:    { display:'flex', alignItems:'center', gap:8, marginBottom:10 },
    weekBadge:     { fontSize:11, fontWeight:500, background:'#EEEDFE', color:'#3C3489', padding:'2px 10px', borderRadius:99, flexShrink:0 },
    weekLine:      { flex:1, height:'0.5px', background:br },
    aiBox:         { display:'flex', alignItems:'center', gap:4, background:'#EEEDFE', borderRadius:6, padding:'3px 10px', flexShrink:0 },
    aiText:        { fontSize:11, color:'#534AB7', fontWeight:500 },
    rawBtn:        { fontSize:11, padding:'1px 6px', borderRadius:4, border:'1px solid #AFA9EC', background:'transparent', color:'#534AB7', cursor:'pointer', marginLeft:4 },
    dateLabel:     { fontSize:12, fontWeight:500, color:tx0 },
    timeLabel:     { fontSize:11, color:tx1, fontWeight:400 },
    authorLabel:   { fontSize:11, color:tx1 },
    commentText:   { fontSize:12, color:tx2, lineHeight:1.6, margin:0 },
    editBtn:       { fontSize:11, padding:'1px 8px', borderRadius:4, border:`1px solid ${dark?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:tx1, cursor:'pointer' },
    btnPromote:    { fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid #7c3aed', background:'transparent', color:'#7c3aed', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
    btnDrop:       { fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid #dc2626', background:'transparent', color:'#dc2626', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
    btnClose:      { fontSize:20, color:tx1, background:'none', border:'none', cursor:'pointer', lineHeight:1, padding:'0 4px' },
    btnComment:    { fontSize:12, padding:'5px 14px', borderRadius:6, border:'1px solid #7c3aed', background:'transparent', color:'#7c3aed', cursor:'pointer', fontFamily:"'Geist', sans-serif", fontWeight:500 },
  }
}
