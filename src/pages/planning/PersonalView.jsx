import { useState, useMemo } from 'react'
import { useDeals } from './useDeals'
import { useOpportunities } from './useOpportunities'
import { FALLBACK_RATES, CCY_SYMS, CCY_LABELS, STATUS_STYLE, getPriorityGroup, PRIORITY_LABEL, getAlias } from './constants'

// ── 환율 훅 ──────────────────────────────────────────
function useCurrency() {
  const [ccy, setCcy] = useState('KRW')
  const [rates, setRates] = useState(FALLBACK_RATES)
  const [rateStatus, setRateStatus] = useState('loading')
  useState(() => {
    fetch('https://api.exchangerate-api.com/v4/latest/KRW')
      .then(r => r.json())
      .then(data => { setRates({ KRW:1, USD:data.rates.USD, CNY:data.rates.CNY, JPY:data.rates.JPY, EUR:data.rates.EUR }); setRateStatus('live') })
      .catch(() => { setRates(FALLBACK_RATES); setRateStatus('fallback') })
  }, [])
  const fmtK = (krw) => {
    if (!krw) return '—'
    const v = krw * rates[ccy]
    const s = CCY_SYMS[ccy]
    if (ccy === 'KRW') return s + Math.round(v).toLocaleString() + 'K'
    if (ccy === 'JPY') return s + Math.round(v / 10).toLocaleString() + '万'
    return s + v.toFixed(1) + 'K'
  }
  return { ccy, setCcy, rates, rateStatus, fmtK }
}

export default function PersonalView({ darkMode, session }) {
  const s = useMemo(() => getStyles(darkMode), [darkMode])
  const { ccy, setCcy, rateStatus, fmtK } = useCurrency()
  const myAlias = getAlias(session)

  const [quarterRange, setQuarterRange] = useState({ start: 0, end: 99 })
  const [drawerItem, setDrawerItem]     = useState(null) // { type: 'deal'|'opp', data }
  const [addOppOpen, setAddOppOpen]     = useState(false)
  const [toast, setToast]               = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  const { filteredDeals, quarters, loading: dealsLoading, loadDeals } = useDeals({
    session, mode: 'personal', quarterRange,
  })

  const { myOpportunities, loading: oppLoading, loadOpportunities, updatePriority, promoteOpportunity, dropOpportunity } = useOpportunities({ session })

  const loading = dealsLoading || oppLoading

  // 중요도 그룹별 분류
  const oppGrouped = {
    high:  myOpportunities.filter(o => getPriorityGroup(o.priority) === 'high'),
    mid:   myOpportunities.filter(o => getPriorityGroup(o.priority) === 'mid'),
    low:   myOpportunities.filter(o => getPriorityGroup(o.priority) === 'low'),
    dummy: myOpportunities.filter(o => getPriorityGroup(o.priority) === 'dummy'),
  }

  if (loading) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
      <div style={{ width:8, height:8, borderRadius:'50%', background:'#7c3aed' }} />
      <span style={{ fontSize:13, color:'#6b7280' }}>로딩 중...</span>
    </div>
  )

  return (
    <div style={s.wrap}>

      {/* ── 툴바 ── */}
      <div style={s.toolbar}>
        <span style={s.pageTitle}>{myAlias} 님의 뷰</span>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
          <div style={s.ccyWrap}>
            <span style={s.ccyLabel}>단위</span>
            <select style={s.ccySel} value={ccy} onChange={e => setCcy(e.target.value)}>
              {['KRW','USD','CNY','JPY','EUR'].map(c => <option key={c} value={c}>{CCY_LABELS[c]}</option>)}
            </select>
            <div style={{ ...s.rateDot, background: rateStatus==='live' ? '#4ade80' : '#fbbf24' }} />
          </div>
        </div>
      </div>

      {/* ── 바디 ── */}
      <div style={s.body}>

        {/* ── 정식 프로젝트 섹션 ── */}
        <div style={s.sectionHeader}>
          <span style={s.sectionTitle}>정식 프로젝트</span>
          <span style={s.sectionCount}>{filteredDeals.length}건</span>
        </div>

        <div style={s.tableCard}>
          <table style={s.tbl}>
            <colgroup>
              <col style={{ width:'30%' }} />
              <col style={{ width:'12%' }} />
              <col style={{ width:'10%' }} />
              <col style={{ width:'13%' }} />
              <col style={{ width:'13%' }} />
              <col style={{ width:'10%' }} />
              <col style={{ width:'12%' }} />
            </colgroup>
            <thead>
              <tr>
                {[['프로젝트','left'],['고객사','left'],['분기','center'],['계약금액','right'],['반영금액','right'],['확도','center'],['상태','center']].map(([h, a], i) => (
                  <th key={i} style={{ ...s.th, textAlign: a }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredDeals.length === 0 ? (
                <tr><td colSpan={7} style={s.empty}>담당 프로젝트가 없습니다</td></tr>
              ) : filteredDeals.map(deal => (
                <tr key={deal.id} style={s.tr}
                  onClick={() => setDrawerItem({ type: 'deal', data: deal })}
                  onMouseEnter={e => e.currentTarget.style.background = darkMode ? '#1a1a1a' : '#f5f3ff'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={s.td}>
                    <div style={s.caseName}>{deal.case_name}</div>
                    <div style={s.caseSub}>{deal.product_cat}</div>
                  </td>
                  <td style={s.td}><span style={s.chip}>{deal.customer}</span></td>
                  <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{deal.quarter}</span></td>
                  <td style={{ ...s.td, textAlign:'right' }}>{fmtK(deal.book_amount)}</td>
                  <td style={{ ...s.td, textAlign:'right' }}>{fmtK(Math.round((deal.book_amount * deal.probability) / 100))}</td>
                  <td style={{ ...s.td, textAlign:'center' }}>
                    <ConfBar pct={deal.probability || 0} />
                  </td>
                  <td style={{ ...s.td, textAlign:'center' }}>
                    <StatusBadge status={deal.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── 구분선 ── */}
        <div style={s.divider}>
          <div style={s.dividerLine} />
          <span style={s.dividerLabel}>오퍼튜니티</span>
          <div style={s.dividerLine} />
          <button style={s.addBtn} onClick={() => setAddOppOpen(true)}>+ 추가</button>
        </div>

        {/* ── 오퍼튜니티 섹션 ── */}
        {myOpportunities.length === 0 ? (
          <div style={s.emptyOpp}>
            <p style={{ fontSize:13, color:'#6b7280', marginBottom:8 }}>등록된 오퍼튜니티가 없어요</p>
            <button style={s.addBtn} onClick={() => setAddOppOpen(true)}>+ 오퍼튜니티 추가</button>
          </div>
        ) : (
          ['high','mid','low','dummy'].map(group => {
            const items = oppGrouped[group]
            if (items.length === 0) return null
            const { label, color, bg } = PRIORITY_LABEL[group]
            return (
              <div key={group} style={{ marginBottom: 16 }}>
                <div style={s.oppGroupHeader}>
                  <span style={{ ...s.oppGroupBadge, background: bg, color }}>{label}</span>
                  <span style={s.sectionCount}>{items.length}건</span>
                  <div style={s.dividerLine} />
                </div>
                <div style={s.tableCard}>
                  <table style={s.tbl}>
                    <colgroup>
                      <col style={{ width:'28%' }} />
                      <col style={{ width:'11%' }} />
                      <col style={{ width:'10%' }} />
                      <col style={{ width:'12%' }} />
                      <col style={{ width:'10%' }} />
                      <col style={{ width:'10%' }} />
                      <col style={{ width:'10%' }} />
                      <col style={{ width:'9%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        {[['프로젝트','left'],['고객사','left'],['예상분기','center'],['예상금액','right'],['중요도','center'],['확도','center'],['상태','center'],['','center']].map(([h,a],i) => (
                          <th key={i} style={{ ...s.th, textAlign:a }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(opp => (
                        <tr key={opp.id} style={s.tr}
                          onClick={() => setDrawerItem({ type: 'opp', data: opp })}
                          onMouseEnter={e => e.currentTarget.style.background = darkMode ? '#1a1a1a' : '#f5f3ff'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <td style={s.td}>
                            <div style={s.caseName}>{opp.title}</div>
                            <div style={s.caseSub}>{opp.product}</div>
                          </td>
                          <td style={s.td}><span style={s.chip}>{opp.customer}</span></td>
                          <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{opp.expected_date || '—'}</span></td>
                          <td style={{ ...s.td, textAlign:'right' }}>{fmtK(opp.amount)}</td>
                          <td style={{ ...s.td, textAlign:'center' }}>
                            <PriorityBadge priority={opp.priority} />
                          </td>
                          <td style={{ ...s.td, textAlign:'center' }}>
                            <ConfBar pct={opp.confidence || 0} />
                          </td>
                          <td style={{ ...s.td, textAlign:'center' }}>
                            <OppStatusBadge status={opp.status} />
                          </td>
                          <td style={{ ...s.td, textAlign:'center' }} onClick={e => e.stopPropagation()}>
                            <div style={{ display:'flex', gap:4, justifyContent:'center' }}>
                              <button style={s.promoteBtn}
                                title="정식딜로 승격"
                                onClick={() => {
                                  // 승격 플로우는 드로어에서 처리
                                  setDrawerItem({ type: 'opp', data: opp })
                                }}>↑</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* ── 드로어 ── */}
      {drawerItem && (
        <Drawer
          item={drawerItem}
          darkMode={darkMode}
          session={session}
          fmtK={fmtK}
          onClose={() => setDrawerItem(null)}
          onPromote={async (oppId, dealId) => {
            const { error } = await promoteOpportunity(oppId, dealId)
            if (!error) { showToast('정식딜로 승격했어요 🎉'); loadOpportunities(); loadDeals() }
          }}
          onDrop={async (oppId) => {
            const { error } = await dropOpportunity(oppId)
            if (!error) { showToast('오퍼튜니티를 드랍했어요', 'info'); setDrawerItem(null) }
          }}
          onPriorityChange={async (oppId, p) => {
            await updatePriority(oppId, p)
            loadOpportunities()
          }}
        />
      )}

      {/* ── 오퍼튜니티 추가 모달 ── */}
      {addOppOpen && (
        <AddOpportunityModal
          darkMode={darkMode}
          session={session}
          onClose={() => setAddOppOpen(false)}
          onSaved={() => { setAddOppOpen(false); loadOpportunities(); showToast('오퍼튜니티를 추가했어요') }}
        />
      )}

      {/* ── 토스트 ── */}
      {toast && (
        <div style={{
          position:'fixed', bottom:24, right:24, zIndex:9999,
          background: toast.type==='info' ? (darkMode?'#0f2010':'#f0fdf4') : (darkMode?'#1e1635':'#ede9fe'),
          border: `1px solid ${toast.type==='info' ? '#4ade80' : '#7c3aed'}`,
          color: toast.type==='info' ? (darkMode?'#4ade80':'#16a34a') : (darkMode?'#c4b5fd':'#5b21b6'),
          padding:'10px 18px', borderRadius:8, fontSize:13, fontWeight:500, fontFamily:"'Geist', sans-serif",
        }}>{toast.msg}</div>
      )}
    </div>
  )
}

// ── 드로어 ────────────────────────────────────────────
function Drawer({ item, darkMode, session, fmtK, onClose, onPromote, onDrop, onPriorityChange }) {
  const { type, data } = item
  const s = useMemo(() => getStyles(darkMode), [darkMode])
  const [comments, setComments]     = useState([])
  const [loadingC, setLoadingC]     = useState(true)
  const [commentOpen, setCommentOpen] = useState(false)

  const { supabase } = require('../../supabase') // lazy

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

  useState(() => { loadComments() }, [data.id])

  // 주차별 그룹
  const grouped = comments.reduce((acc, c) => {
    const w = c.week_label || '—'
    if (!acc[w]) acc[w] = []
    acc[w].push(c)
    return acc
  }, {})

  return (
    <>
      {/* 오버레이 */}
      <div style={{ position:'fixed', inset:0, zIndex:200 }} onClick={onClose} />

      {/* 드로어 패널 */}
      <div style={{
        position:'fixed', top:0, right:0, bottom:0, zIndex:201,
        width: '48%', minWidth: 480,
        background: darkMode ? '#111' : '#fff',
        borderLeft: `1px solid ${darkMode ? '#1f1f1f' : '#e2e2e2'}`,
        display:'flex', flexDirection:'column',
        fontFamily:"'Geist', sans-serif",
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
      }}>

        {/* 헤더 */}
        <div style={{ padding:'14px 20px', borderBottom:`1px solid ${darkMode?'#1f1f1f':'#e2e2e2'}`, display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontSize:15, fontWeight:500, color: darkMode?'#f0f0f0':'#111', marginBottom:6 }}>
              {type === 'deal' ? data.case_name : data.title}
            </p>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
              {type === 'deal' ? (
                <>
                  <StatusBadge status={data.status} />
                  <span style={{ fontSize:11, color:'#6b7280' }}>{data.customer} · {fmtK(data.book_amount)} · {data.quarter}</span>
                </>
              ) : (
                <>
                  <OppStatusBadge status={data.status} />
                  <PriorityBadge priority={data.priority} />
                  <span style={{ fontSize:11, color:'#6b7280' }}>{data.customer} · {fmtK(data.amount)}</span>
                </>
              )}
            </div>
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center', marginLeft:12, flexShrink:0 }}>
            {type === 'opp' && (
              <>
                <button style={{ fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid #7c3aed', background:'transparent', color:'#7c3aed', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                  onClick={() => onPromote(data.id, null)}>↑ 정식딜 승격</button>
                <button style={{ fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid #dc2626', background:'transparent', color:'#dc2626', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                  onClick={() => onDrop(data.id)}>드랍</button>
              </>
            )}
            <button style={{ fontSize:20, color:'#6b7280', background:'none', border:'none', cursor:'pointer', lineHeight:1, padding:'0 4px' }} onClick={onClose}>×</button>
          </div>
        </div>

        {/* + 코멘트 버튼 */}
        <div style={{ padding:'10px 20px', borderBottom:`1px solid ${darkMode?'#1f1f1f':'#e2e2e2'}`, display:'flex', justifyContent:'flex-end' }}>
          <button style={{ fontSize:12, padding:'5px 14px', borderRadius:6, border:'1px solid #7c3aed', background:'transparent', color:'#7c3aed', cursor:'pointer', fontFamily:"'Geist', sans-serif", fontWeight:500 }}
            onClick={() => setCommentOpen(true)}>+ 코멘트</button>
        </div>

        {/* 타임라인 */}
        <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>
          <p style={{ fontSize:11, fontWeight:500, color:'#6b7280', letterSpacing:'0.04em', textTransform:'uppercase', marginBottom:14 }}>타임라인</p>

          {loadingC ? (
            <p style={{ fontSize:12, color:'#6b7280' }}>로딩 중...</p>
          ) : comments.length === 0 ? (
            <p style={{ fontSize:12, color:'#6b7280' }}>아직 기록이 없어요. 코멘트를 추가해보세요!</p>
          ) : (
            Object.entries(grouped).map(([week, items]) => (
              <WeekGroup key={week} week={week} items={items} darkMode={darkMode} onRefresh={loadComments} />
            ))
          )}
        </div>
      </div>

      {/* 코멘트 모달 */}
      {commentOpen && (
        <CommentModal
          entityType={type}
          entityId={data.id}
          isOpp={type === 'opp'}
          currentPriority={data.priority}
          darkMode={darkMode}
          session={session}
          onClose={() => setCommentOpen(false)}
          onSaved={() => { setCommentOpen(false); loadComments() }}
          onPriorityChange={onPriorityChange}
        />
      )}
    </>
  )
}

// ── 주차 그룹 ─────────────────────────────────────────
function WeekGroup({ week, items, darkMode, onRefresh }) {
  const [editingId, setEditingId] = useState(null)
  const [showRaw, setShowRaw]     = useState(false)

  return (
    <div style={{ marginBottom: 20 }}>
      {/* 주차 헤더 */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
        <span style={{ fontSize:11, fontWeight:500, background:'#EEEDFE', color:'#3C3489', padding:'2px 10px', borderRadius:99, flexShrink:0 }}>{week}</span>
        <div style={{ flex:1, height:'0.5px', background: darkMode?'#1f1f1f':'#e2e2e2' }} />
        {/* AI 요약 (추후 연동) */}
        <div style={{ display:'flex', alignItems:'center', gap:4, background:'#EEEDFE', borderRadius:6, padding:'3px 10px', flexShrink:0 }}>
          <span style={{ fontSize:13 }}>✦</span>
          <span style={{ fontSize:11, color:'#534AB7', fontWeight:500 }}>
            {items[0]?.content_summary || 'AI 요약 준비 중'}
          </span>
          <button style={{ fontSize:11, padding:'1px 6px', borderRadius:4, border:'1px solid #AFA9EC', background:'transparent', color:'#534AB7', cursor:'pointer', marginLeft:4 }}
            onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? '요약보기' : '원본보기'}
          </button>
        </div>
        <div style={{ flex:1, height:'0.5px', background: darkMode?'#1f1f1f':'#e2e2e2' }} />
      </div>

      {/* 데일리 항목들 */}
      {items.map((item, i) => (
        <div key={item.id} style={{ display:'flex', gap:10, paddingBottom: i < items.length-1 ? 12 : 0 }}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', width:12, flexShrink:0 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background: i===0 ? '#534AB7' : darkMode?'#374151':'#d1d5db', flexShrink:0 }} />
            {i < items.length-1 && <div style={{ width:1, flex:1, background: darkMode?'#1f1f1f':'#e2e2e2', minHeight:16 }} />}
          </div>
          <div style={{ flex:1, minWidth:0, paddingBottom: i < items.length-1 ? 4 : 0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
              <span style={{ fontSize:12, fontWeight:500, color: darkMode?'#e5e7eb':'#111827' }}>
                {new Date(item.created_at).toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit' })}
                <span style={{ fontSize:11, color:'#6b7280', fontWeight:400, marginLeft:4 }}>
                  {new Date(item.created_at).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' })}
                </span>
                <span style={{ fontSize:11, color:'#6b7280', marginLeft:6 }}>· {item.author}</span>
              </span>
              <button style={{ fontSize:11, padding:'1px 8px', borderRadius:4, border:`1px solid ${darkMode?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer' }}
                onClick={() => setEditingId(editingId === item.id ? null : item.id)}>편집</button>
            </div>
            <p style={{ fontSize:12, color: darkMode?'#d1d5db':'#374151', lineHeight:1.6, margin:0 }}>
              {showRaw ? item.content_raw : (item.content_summary || item.content_raw)}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 코멘트 모달 ───────────────────────────────────────
function CommentModal({ entityType, entityId, isOpp, currentPriority, darkMode, session, onClose, onSaved, onPriorityChange }) {
  const [raw, setRaw]           = useState('')
  const [priority, setPriority] = useState(currentPriority || 10)
  const [saving, setSaving]     = useState(false)
  const [aiPreview, setAiPreview] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)

  const { supabase } = require('../../supabase')
  const { getWeekLabel } = require('./constants')

  const handleAI = async () => {
    if (!raw.trim()) return
    setAiLoading(true)
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 200,
          messages: [{ role:'user', content: `다음 영업 활동 기록을 2-3문장으로 간결하게 요약해줘. 구어체를 정제된 업무 문체로 바꿔줘:\n\n${raw}` }]
        })
      })
      const data = await res.json()
      setAiPreview(data.content?.[0]?.text || null)
    } catch { setAiPreview(null) }
    setAiLoading(false)
  }

  const handleSave = async () => {
    if (!raw.trim()) return
    setSaving(true)
    const alias = session?.user?.user_metadata?.alias || session?.user?.email?.split('@')[0] || 'unknown'
    await supabase.from('timeline_comments').insert({
      entity_type: entityType,
      entity_id: entityId,
      author: alias,
      content_raw: raw,
      content_summary: aiPreview || null,
      week_label: getWeekLabel(new Date()),
      comment_date: new Date().toISOString().split('T')[0],
    })
    // 오퍼튜니티면 중요도도 업데이트
    if (isOpp && onPriorityChange) await onPriorityChange(entityId, priority)
    setSaving(false)
    onSaved()
  }

  const dk = darkMode
  const bg = dk ? '#111' : '#fff'
  const br = dk ? '#2a1f5c' : '#e5e7eb'
  const tx = dk ? '#f0f0f0' : '#111'
  const inp = { fontSize:13, padding:'10px 12px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:dk?'#1a1a1a':'#f9fafb', color:tx, fontFamily:"'Geist', sans-serif", outline:'none', width:'100%', boxSizing:'border-box', resize:'none', lineHeight:1.7 }
  const PRIORITY_OPTS = [{ val:'high', range:[1,3], label:'HIGH', color:'#D85A30', bg:'#FAECE7' }, { val:'mid', range:[4,6], label:'MID', color:'#BA7517', bg:'#FAEEDA' }, { val:'low', range:[7,9], label:'LOW', color:'#639922', bg:'#EAF3DE' }]
  const currentGroup = priority <= 3 ? 'high' : priority <= 6 ? 'mid' : 'low'

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:20 }}>
      <div style={{ background:bg, border:`1px solid ${br}`, borderRadius:12, width:'100%', maxWidth:500, overflow:'hidden', fontFamily:"'Geist', sans-serif" }}>

        {/* 헤더 */}
        <div style={{ background:dk?'#1e1635':'#f5f3ff', padding:'13px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:`1px solid ${br}` }}>
          <span style={{ fontSize:13, fontWeight:500, color:dk?'#c4b5fd':'#5b21b6' }}>활동 기록 추가</span>
          <button onClick={onClose} style={{ fontSize:20, color:'#7c3aed', background:'none', border:'none', cursor:'pointer', lineHeight:1 }}>×</button>
        </div>

        <div style={{ padding:'18px 20px', display:'flex', flexDirection:'column', gap:14 }}>

          {/* 내용 입력 */}
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <label style={{ fontSize:11, color:'#6b7280', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.04em' }}>내용</label>
              <button style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, padding:'3px 10px', borderRadius:99, border:'1px solid #AFA9EC', background:'#EEEDFE', color:'#3C3489', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                onClick={handleAI} disabled={aiLoading}>
                <span style={{ fontSize:13 }}>✦</span>
                <span>{aiLoading ? 'AI 정리 중...' : 'AI로 정리'}</span>
              </button>
            </div>
            <textarea rows={4} style={inp} placeholder="자유롭게 입력하세요. 구어체도 괜찮아요.&#10;예) 오늘 유플러스 담당자한테 연락했는데 투심이 2주 더 걸릴 것 같다고 함" value={raw} onChange={e => setRaw(e.target.value)} />
            {aiPreview && (
              <div style={{ background:'#EEEDFE', border:'1px solid #AFA9EC', borderRadius:6, padding:'10px 12px', marginTop:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:5 }}>
                  <span style={{ fontSize:13 }}>✦</span>
                  <span style={{ fontSize:11, fontWeight:500, color:'#3C3489' }}>AI 요약 미리보기</span>
                  <button style={{ fontSize:11, padding:'1px 6px', borderRadius:4, border:'1px solid #AFA9EC', background:'transparent', color:'#534AB7', cursor:'pointer', marginLeft:'auto' }} onClick={() => setAiPreview(null)}>원본으로 되돌리기</button>
                </div>
                <p style={{ fontSize:12, color:'#3C3489', lineHeight:1.6, margin:0 }}>{aiPreview}</p>
              </div>
            )}
          </div>

          {/* 중요도 — 오퍼튜니티만 */}
          {isOpp && (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                <label style={{ fontSize:11, color:'#6b7280', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.04em' }}>중요도 업데이트</label>
                <span style={{ fontSize:10, color:'#D85A30', fontWeight:500 }}>필수</span>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                {PRIORITY_OPTS.map(({ val, range, label, color, bg: pbg }) => (
                  <button key={val}
                    style={{ fontSize:12, padding:'6px 20px', borderRadius:99, border:`1.5px solid ${currentGroup===val ? color : darkMode?'#2a2a2a':'#e5e7eb'}`, background:currentGroup===val ? pbg : 'transparent', color:currentGroup===val ? color : '#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif", fontWeight: currentGroup===val ? 500 : 400, transition:'all .15s' }}
                    onClick={() => setPriority(range[0])}>
                    {label}
                  </button>
                ))}
              </div>
              <p style={{ fontSize:11, color:'#6b7280', marginTop:6 }}>현재: {currentGroup.toUpperCase()} (우선순위 {priority}) — 저장 전 반드시 확인</p>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div style={{ padding:'12px 20px', borderTop:`1px solid ${br}`, display:'flex', justifyContent:'flex-end', gap:8, background:dk?'#0d0d0d':'#f9fafb' }}>
          <button onClick={onClose} style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>취소</button>
          <button onClick={handleSave} disabled={saving || !raw.trim()} style={{ fontSize:12, padding:'6px 18px', borderRadius:6, border:'none', background: saving||!raw.trim() ? '#4c1d95' : '#7c3aed', color:'#f0f0f0', cursor: saving||!raw.trim() ? 'not-allowed' : 'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" }}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AddOpportunityModal ───────────────────────────────
function AddOpportunityModal({ darkMode, session, onClose, onSaved }) {
  const { supabase } = require('../../supabase')
  const { getAlias } = require('./constants')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const [title, setTitle]   = useState('')
  const [customer, setCustomer] = useState('')
  const [product, setProduct]   = useState('')
  const [currency, setCurrency] = useState('KRW')
  const [amount, setAmount]     = useState(0)
  const [expectedDate, setExpectedDate] = useState('')
  const [status, setStatus]     = useState('Idea')
  const [confidence, setConfidence] = useState(0)
  const [priority, setPriority] = useState(5)
  const STATUS_OPTS = ['Idea','In Progress','Forecast']
  const PRIORITY_OPTS = [{ val:'high', range:[1,3], label:'HIGH', color:'#D85A30', bg:'#FAECE7' }, { val:'mid', range:[4,6], label:'MID', color:'#BA7517', bg:'#FAEEDA' }, { val:'low', range:[7,9], label:'LOW', color:'#639922', bg:'#EAF3DE' }]
  const currentGroup = priority <= 3 ? 'high' : priority <= 6 ? 'mid' : 'low'

  const handleSave = async () => {
    if (!title.trim()) { setError('프로젝트명을 입력해주세요'); return }
    setSaving(true); setError(null)
    const { error } = await supabase.from('opportunities').insert({
      title, customer, product, currency, amount, expected_date: expectedDate || null,
      status, confidence, priority,
      owner: getAlias(session), is_active: true,
      created_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    onSaved()
  }

  const dk = darkMode
  const bg = dk?'#111':'#fff', br = dk?'#2a1f5c':'#e5e7eb', tx = dk?'#f0f0f0':'#111'
  const inp = { fontSize:12, padding:'7px 9px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:dk?'#1a1a1a':'#f9fafb', color:tx, fontFamily:"'Geist', sans-serif", outline:'none', width:'100%', boxSizing:'border-box' }
  const lbl = { fontSize:11, color:'#6b7280', marginBottom:4, display:'block' }
  const field = { display:'flex', flexDirection:'column', gap:3 }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:20 }}>
      <div style={{ background:bg, border:`1px solid ${br}`, borderRadius:12, width:'100%', maxWidth:580, overflow:'hidden', fontFamily:"'Geist', sans-serif" }}>
        <div style={{ background:dk?'#1e1635':'#f5f3ff', padding:'13px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:`1px solid ${br}` }}>
          <span style={{ fontSize:13, fontWeight:500, color:dk?'#c4b5fd':'#5b21b6' }}>+ 오퍼튜니티 추가</span>
          <button onClick={onClose} style={{ fontSize:20, color:'#7c3aed', background:'none', border:'none', cursor:'pointer', lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:'20px 20px 0' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:12, marginBottom:14 }}>
            <div style={{ ...field, gridColumn:'span 2' }}><label style={lbl}>프로젝트명 *</label><input style={inp} value={title} onChange={e => setTitle(e.target.value)} /></div>
            <div style={field}><label style={lbl}>고객사</label><input style={inp} value={customer} onChange={e => setCustomer(e.target.value)} /></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:12, marginBottom:14 }}>
            <div style={field}><label style={lbl}>제품/분류</label><input style={inp} value={product} onChange={e => setProduct(e.target.value)} /></div>
            <div style={field}><label style={lbl}>통화</label><select style={{...inp}} value={currency} onChange={e => setCurrency(e.target.value)}>{['KRW','USD','CNY','JPY','EUR'].map(c => <option key={c}>{c}</option>)}</select></div>
            <div style={field}><label style={lbl}>예상 금액 (K)</label><input style={inp} type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} /></div>
            <div style={field}><label style={lbl}>예상 계약월</label><input style={inp} type="month" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} /></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
            <div style={field}><label style={lbl}>상태</label><div style={{ display:'flex', gap:6 }}>{STATUS_OPTS.map(v => <button key={v} style={{ fontSize:11, padding:'4px 10px', borderRadius:5, border:`1px solid ${status===v?'#7c3aed':dk?'#2a2a2a':'#e5e7eb'}`, background:status===v?'rgba(124,58,237,0.1)':'transparent', color:status===v?'#7c3aed':'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }} onClick={() => setStatus(v)}>{v}</button>)}</div></div>
            <div style={field}><label style={lbl}>확도 (%)</label><input style={inp} type="number" min={0} max={100} value={confidence} onChange={e => setConfidence(Number(e.target.value))} /></div>
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={lbl}>초기 중요도</label>
            <div style={{ display:'flex', gap:8 }}>
              {PRIORITY_OPTS.map(({ val, range, label, color, bg: pbg }) => (
                <button key={val} style={{ fontSize:12, padding:'6px 20px', borderRadius:99, border:`1.5px solid ${currentGroup===val?color:dk?'#2a2a2a':'#e5e7eb'}`, background:currentGroup===val?pbg:'transparent', color:currentGroup===val?color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif", fontWeight:currentGroup===val?500:400 }}
                  onClick={() => setPriority(range[0])}>{label}</button>
              ))}
            </div>
          </div>
          {error && <div style={{ fontSize:12, color:'#f87171', marginBottom:12 }}>{error}</div>}
        </div>
        <div style={{ padding:'12px 20px', background:dk?'#0d0d0d':'#f9fafb', display:'flex', justifyContent:'flex-end', gap:8, borderTop:`1px solid ${br}` }}>
          <button onClick={onClose} style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{ fontSize:12, padding:'6px 18px', borderRadius:6, border:'none', background:saving?'#4c1d95':'#7c3aed', color:'#f0f0f0', cursor:saving?'not-allowed':'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" }}>{saving?'저장 중...':'저장'}</button>
        </div>
      </div>
    </div>
  )
}

// ── 서브 컴포넌트들 ───────────────────────────────────
function StatusBadge({ status }) {
  const st = STATUS_STYLE[status] || STATUS_STYLE.active
  return <span style={{ display:'inline-block', fontSize:11, padding:'2px 7px', borderRadius:4, fontWeight:500, background:st.bg, color:st.color }}>{st.label}</span>
}

function OppStatusBadge({ status }) {
  const map = { 'Idea':{ bg:'#F1EFE8', color:'#444441' }, 'In Progress':{ bg:'#E6F1FB', color:'#0C447C' }, 'Forecast':{ bg:'#FAEEDA', color:'#633806' }, 'Promoted':{ bg:'#EAF3DE', color:'#27500A' }, 'Dropped':{ bg:'#FCEBEB', color:'#791F1F' } }
  const st = map[status] || map['Idea']
  return <span style={{ display:'inline-block', fontSize:11, padding:'2px 7px', borderRadius:4, fontWeight:500, background:st.bg, color:st.color }}>{status}</span>
}

function PriorityBadge({ priority }) {
  const group = getPriorityGroup(priority)
  const { label, color, bg } = PRIORITY_LABEL[group]
  return <span style={{ display:'inline-block', fontSize:11, padding:'2px 7px', borderRadius:4, fontWeight:500, background:bg, color }}>{label}</span>
}

function ConfBar({ pct }) {
  const color = pct >= 100 ? '#4ade80' : pct >= 60 ? '#60a5fa' : pct >= 30 ? '#fbbf24' : '#4b5563'
  return (
    <div style={{ display:'flex', alignItems:'center', gap:5, justifyContent:'center' }}>
      <div style={{ width:40, height:3, background:'#d1d5db', borderRadius:2, overflow:'hidden' }}>
        <div style={{ width:pct+'%', height:'100%', background:color, borderRadius:2 }} />
      </div>
      <span style={{ fontSize:11, color:'#9ca3af' }}>{pct}%</span>
    </div>
  )
}

// ── 스타일 ────────────────────────────────────────────
function getStyles(dark) {
  const bg1 = dark?'#111':'#fff', bg2 = dark?'#1a1a1a':'#f0f0f0', bg3 = dark?'#0d0d0d':'#e8e8e8'
  const br  = dark?'#1f1f1f':'#e2e2e2', br2 = dark?'#2a2a2a':'#d1d5db'
  const tx0 = dark?'#f0f0f0':'#111', tx1 = dark?'#6b7280':'#6b7280', tx2 = dark?'#d1d5db':'#374151', tx3 = dark?'#4b5563':'#9ca3af'
  return {
    wrap:       { flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:dark?'#0a0a0a':'#f5f5f7', fontFamily:"'Geist', sans-serif" },
    toolbar:    { display:'flex', alignItems:'center', padding:'8px 24px', background:dark?'#0f0f0f':'#fafafa', borderBottom:'1px solid '+br, gap:8 },
    pageTitle:  { fontSize:13, fontWeight:500, color:tx0 },
    ccyWrap:    { display:'flex', alignItems:'center', gap:6, height:30, background:bg2, border:'1px solid '+br2, borderRadius:8, padding:'0 10px' },
    ccyLabel:   { fontSize:11, color:tx1 },
    ccySel:     { fontSize:12, fontWeight:500, color:tx0, border:'none', background:'transparent', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
    rateDot:    { width:6, height:6, borderRadius:'50%' },
    body:       { flex:1, overflowY:'auto', padding:'16px 24px', display:'flex', flexDirection:'column', gap:10 },
    sectionHeader: { display:'flex', alignItems:'center', gap:8 },
    sectionTitle:  { fontSize:13, fontWeight:500, color:tx0 },
    sectionCount:  { fontSize:11, color:tx1, background:bg2, padding:'2px 8px', borderRadius:99 },
    tableCard:  { background:bg1, border:'1px solid '+br, borderRadius:10, overflow:'hidden' },
    tbl:        { width:'100%', borderCollapse:'collapse', tableLayout:'fixed' },
    th:         { fontSize:11, fontWeight:500, color:tx3, padding:'7px 14px', borderBottom:'1px solid '+br, background:bg3, whiteSpace:'nowrap' },
    td:         { fontSize:12, color:tx2, padding:'9px 14px', borderBottom:'1px solid '+(dark?'#161616':'#f0f0f0'), verticalAlign:'middle' },
    tr:         { cursor:'pointer', transition:'background .1s' },
    empty:      { padding:'28px', textAlign:'center', color:'#6b7280', fontSize:13 },
    caseName:   { fontSize:12, fontWeight:500, color:dark?'#e5e7eb':'#111827', marginBottom:2 },
    caseSub:    { fontSize:11, color:tx1 },
    chip:       { fontSize:11, color:tx1, background:bg2, padding:'2px 7px', borderRadius:4 },
    divider:    { display:'flex', alignItems:'center', gap:10, margin:'6px 0' },
    dividerLine:{ flex:1, height:'1px', background: dark?'#1f1f1f':'#e2e2e2', borderTop:'1px dashed '+(dark?'#2a2a2a':'#d1d5db') },
    dividerLabel:{ fontSize:11, fontWeight:500, color:tx1, whiteSpace:'nowrap', letterSpacing:'0.05em', textTransform:'uppercase' },
    addBtn:     { fontSize:11, padding:'4px 12px', borderRadius:6, border:'1px solid #7c3aed', background:'transparent', color:'#7c3aed', cursor:'pointer', fontFamily:"'Geist', sans-serif", whiteSpace:'nowrap' },
    emptyOpp:   { textAlign:'center', padding:'32px 0' },
    oppGroupHeader: { display:'flex', alignItems:'center', gap:8, marginBottom:6 },
    oppGroupBadge:  { fontSize:11, fontWeight:500, padding:'2px 10px', borderRadius:99 },
    promoteBtn: { fontSize:12, padding:'2px 8px', borderRadius:4, border:'1px solid #7c3aed', background:'transparent', color:'#7c3aed', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
  }
}
