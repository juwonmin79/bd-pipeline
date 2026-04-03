import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

// ── 환율 ──────────────────────────────────────────
const FALLBACK_RATES = { KRW: 1, USD: 1/1510, CNY: 1/217, JPY: 1/9.47, EUR: 1/1728 }
const CCY_SYMS = { KRW: '', USD: '$', CNY: '¥', JPY: '¥', EUR: '€' }
const CCY_LABELS = { KRW: '원화', USD: 'USD', CNY: 'CNY', JPY: 'JPY', EUR: 'EUR' }

// ── 상태 배지 색상 ─────────────────────────────────
const STATUS_STYLE = {
  won:     { bg: '#1a2e1a', color: '#4ade80', label: 'Won' },
  active:  { bg: '#1a2433', color: '#60a5fa', label: '진행' },
  drop:    { bg: '#2e1a1a', color: '#f87171', label: 'Drop' },
  pending: { bg: '#2a2310', color: '#fbbf24', label: '대기' },
}

const CATEGORY_STYLE = {
  Pick:     { bg: '#1a2433', color: '#60a5fa' },
  New:      { bg: '#1a2e1a', color: '#4ade80' },
  Maintain: { bg: '#2a2310', color: '#fbbf24' },
  Drop:     { bg: '#2e1a1a', color: '#f87171' },
}

export default function App() {
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('admin') // personal | admin | sim
  const [ccy, setCcy] = useState('KRW')
  const [rates, setRates] = useState(FALLBACK_RATES)
  const [rateStatus, setRateStatus] = useState('loading') // loading | live | fallback
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [quarterRange, setQuarterRange] = useState({ start: 0, end: 3 })
  const [simChanges, setSimChanges] = useState({}) // id → changed deal
  const [simChildren, setSimChildren] = useState({}) // id → [child deals]
  const [editingId, setEditingId] = useState(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [diffChecked, setDiffChecked] = useState({})

  // ── 데이터 로드 ──────────────────────────────────
  const loadDeals = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('is_simulation', false)
      .order('created_at', { ascending: true })
    if (error) { setError(error.message); setLoading(false); return }
    setDeals(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadDeals() }, [loadDeals])

  // ── 환율 로드 ────────────────────────────────────
  useEffect(() => {
    fetch('https://api.exchangerate-api.com/v4/latest/KRW')
      .then(r => r.json())
      .then(data => {
        setRates({ KRW: 1, USD: data.rates.USD, CNY: data.rates.CNY, JPY: data.rates.JPY, EUR: data.rates.EUR })
        setRateStatus('live')
      })
      .catch(() => { setRates(FALLBACK_RATES); setRateStatus('fallback') })
  }, [])

  // ── 분기 목록 (DB 기반) ─────────────────────────
  const quarters = [...new Set(deals.map(d => d.quarter).filter(Boolean))].sort()

  // ── 필터된 딜 ───────────────────────────────────
  const filteredDeals = deals.filter(d => {
    if (mode === 'personal' && d.created_by !== 'Jake') return false
    if (ownerFilter !== 'all' && d.created_by !== ownerFilter) return false
    const qi = quarters.indexOf(d.quarter)
    if (quarters.length > 0 && (qi < quarterRange.start || qi > quarterRange.end)) return false
    return true
  })

  // ── 금액 변환 ────────────────────────────────────
  const cvt = (krw) => krw * rates[ccy]
  const fmtK = (krw) => {
    if (!krw) return '—'
    const v = cvt(krw)
    const s = CCY_SYMS[ccy]
    if (ccy === 'KRW') return s + Math.round(v / 1000).toLocaleString() + 'K'
    if (ccy === 'JPY') return s + Math.round(v / 10000).toLocaleString() + '万'
    return s + (v / 1000).toFixed(1) + 'K'
  }

  // ── KPI 계산 ─────────────────────────────────────
  const simDealMap = { ...Object.fromEntries(filteredDeals.map(d => [d.id, d])), ...simChanges }
  const activeForecast = Object.values(simDealMap)
    .filter(d => d.status !== 'drop')
    .reduce((s, d) => s + (d.reflected_amount || Math.round((d.book_amount * d.probability) / 100) || 0), 0)
  const wonAmount = filteredDeals
    .filter(d => d.status === 'won')
    .reduce((s, d) => s + (d.book_amount || 0), 0)
  const targetAmount = filteredDeals.reduce((s, d) => s + (d.target_amount || 0), 0)
  const gap = Math.max(0, targetAmount - activeForecast)
  const achieveRate = targetAmount > 0 ? Math.round((activeForecast / targetAmount) * 100) : 0

  // 시뮬 KPI
  const hasSimChanges = Object.keys(simChanges).length > 0
  const simForecast = hasSimChanges ? activeForecast : null

  // 담당자 목록
  const owners = [...new Set(deals.map(d => d.created_by).filter(Boolean))]

  // ── 시뮬 편집 적용 ───────────────────────────────
  const applySimEdit = (id, updates) => {
    setSimChanges(prev => ({ ...prev, [id]: { ...deals.find(d => d.id === id), ...prev[id], ...updates } }))
    setDiffChecked(prev => ({ ...prev, [id]: true }))
    setEditingId(null)
  }

  // ── 커밋 ─────────────────────────────────────────
  const doCommit = async () => {
    const toCommit = Object.keys(diffChecked).filter(id => diffChecked[id])
    for (const id of toCommit) {
      const change = simChanges[id]
      if (!change) continue
      await supabase.from('projects').update({
        book_amount: change.book_amount,
        probability: change.probability,
        quarter: change.quarter,
        status: change.status,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
    }
    setSimChanges({})
    setSimChildren({})
    setDiffChecked({})
    setDiffOpen(false)
    setCommitMsg('')
    setMode('admin')
    loadDeals()
  }

  if (loading) return (
    <div style={styles.loadWrap}>
      <div style={styles.loadDot} />
      <span style={styles.loadTxt}>BD Pipeline 로딩 중...</span>
    </div>
  )

  if (error) return (
    <div style={styles.loadWrap}>
      <span style={{ color: '#f87171', fontSize: 14 }}>연결 오류: {error}</span>
    </div>
  )

  return (
    <div style={styles.root}>
      {/* NAV */}
      <nav style={styles.nav}>
        <div style={styles.navLeft}>
          <div style={styles.logo}>BD <span style={styles.logoAccent}>Pipeline</span></div>
          <div style={styles.modeTabs}>
            {[['personal','개인 뷰'],['admin','관리자 뷰'],['sim','시뮬레이션']].map(([m, label]) => (
              <button key={m} style={{...styles.modeTab, ...(mode===m ? (m==='sim' ? styles.modeTabSimActive : styles.modeTabActive) : {})}}
                onClick={() => setMode(m)}>{label}</button>
            ))}
          </div>
        </div>
        <div style={styles.navRight}>
          {/* 환율 선택 */}
          <div style={styles.ccyWrap}>
            <span style={styles.ccyLabel}>단위</span>
            <select style={styles.ccySel} value={ccy} onChange={e => setCcy(e.target.value)}>
              {['KRW','USD','CNY','JPY','EUR'].map(c => (
                <option key={c} value={c}>{CCY_LABELS[c]}</option>
              ))}
            </select>
            <div style={{...styles.rateDot, background: rateStatus==='live' ? '#4ade80' : rateStatus==='loading' ? '#fbbf24' : '#6b7280'}} />
            <span style={styles.rateLabel}>{rateStatus==='live' ? '실시간' : rateStatus==='loading' ? '...' : '기준값'}</span>
          </div>
          <div style={styles.avatar}>J</div>
          <span style={styles.userName}>Jake</span>
        </div>
      </nav>

      {/* SIM BANNER */}
      {mode === 'sim' && (
        <div style={styles.simBanner}>
          <div style={styles.simBannerLeft}>
            <div style={styles.simPulse} />
            <div>
              <div style={styles.simBannerTitle}>시뮬레이션 모드</div>
              <div style={styles.simBannerSub}>실제 DB 불변 — 커밋 전까지 샌드박스</div>
            </div>
            <span style={styles.chgPill}>{Object.keys(simChanges).length}건 변경</span>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button style={styles.btnDiscard} onClick={() => { setSimChanges({}); setSimChildren({}); setMode('admin') }}>폐기</button>
            <button style={styles.btnDiff} onClick={() => setDiffOpen(true)}>Diff 리뷰 →</button>
          </div>
        </div>
      )}

      {/* TOOLBAR */}
      <div style={styles.toolbar}>
        <div style={styles.toolbarLeft}>
          {/* 분기 범위 */}
          <QuarterRangePicker quarters={quarters} range={quarterRange} onChange={setQuarterRange} />
          {/* 담당자 필터 */}
          <select style={styles.ownerSel} value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
            <option value="all">전체 담당자</option>
            {owners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <span style={styles.modeLabel}>
          {mode==='personal' ? '개인 뷰 — 내 담당' : mode==='admin' ? '관리자 뷰 — 전체 파이프라인' : '시뮬레이션 모드'}
          {' · '}<span style={{ color:'#6b7280' }}>{filteredDeals.length}건</span>
        </span>
      </div>

      {/* BODY */}
      <div style={styles.body}>

        {/* KPI */}
        <div style={styles.kpiRow}>
          <KpiCard dot="#4ade80" label="확정 매출" value={fmtK(wonAmount)} sub={`Won ${filteredDeals.filter(d=>d.status==='won').length}건`} />
          <KpiCard dot="#60a5fa" label="예측 매출" value={fmtK(activeForecast)} sub="확도 반영 합산"
            sim={hasSimChanges && mode==='sim' ? { value: fmtK(simForecast), delta: activeForecast - (deals.reduce((s,d)=>s+(d.reflected_amount||0),0)) } : null} fmtK={fmtK} />
          <KpiCard dot="#fbbf24" label="사업계획 목표" value={fmtK(targetAmount)} sub="연간 합산" />
          <KpiCard dot="#f87171" label="갭 (부족)" value={fmtK(gap)} sub={`달성률 ${achieveRate}%`} isGap achieveRate={achieveRate} />
        </div>

        {/* DEAL TABLE */}
        <div style={styles.tblCard}>
          <div style={styles.tblTop}>
            <span style={styles.tblTitle}>딜 목록</span>
            {mode==='sim' && <span style={styles.simHint}>● 시뮬레이션 변경 하이라이트</span>}
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={styles.tbl}>
              <thead>
                <tr>
                  {['상태','카테고리','Case / 고객사','제품','국가',`계약금액`,`반영금액`,'확도','담당자','분기',''].map((h,i) => (
                    <th key={i} style={{...styles.th, textAlign: i>=5&&i<=6 ? 'right' : 'left'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredDeals.length === 0 ? (
                  <tr><td colSpan={11} style={{ padding:'32px', textAlign:'center', color:'#6b7280', fontSize:13 }}>데이터가 없습니다</td></tr>
                ) : filteredDeals.map(deal => {
                  const d = simChanges[deal.id] || deal
                  const isSim = !!simChanges[deal.id]
                  const isOpen = editingId === deal.id
                  return [
                    <DealRow key={deal.id} deal={d} orig={deal} isSim={isSim} isOpen={isOpen} mode={mode}
                      fmtK={fmtK} onToggle={() => setEditingId(isOpen ? null : deal.id)} />,
                    isOpen && mode==='sim' && (
                      <tr key={deal.id+'-edit'}>
                        <td colSpan={11} style={{ padding:0 }}>
                          <EditPanel deal={d} fmtK={fmtK} quarters={quarters} owners={owners}
                            onApply={(updates) => applySimEdit(deal.id, updates)}
                            onCancel={() => setEditingId(null)}
                            onAddChild={(child) => setSimChildren(prev => ({ ...prev, [deal.id]: [...(prev[deal.id]||[]), child] }))} />
                        </td>
                      </tr>
                    ),
                    ...(simChildren[deal.id]||[]).map((c,ci) => (
                      <ChildRow key={deal.id+'-child-'+ci} child={c} deal={d} fmtK={fmtK} />
                    ))
                  ]
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* DIFF MODAL */}
      {diffOpen && (
        <div style={styles.overlay}>
          <div style={styles.diffModal}>
            <div style={styles.diffHeader}>
              <span style={styles.diffTitle}>Diff 리뷰 — 커밋할 변경 선택</span>
              <button style={styles.diffClose} onClick={() => setDiffOpen(false)}>×</button>
            </div>
            {Object.keys(simChanges).length === 0 ? (
              <div style={{ padding:'24px 20px', color:'#6b7280', fontSize:13, textAlign:'center' }}>변경된 딜이 없습니다</div>
            ) : Object.entries(simChanges).map(([id, changed]) => {
              const orig = deals.find(d => d.id === id)
              if (!orig) return null
              return (
                <div key={id} style={styles.diffItem}>
                  <div style={{...styles.diffChk, ...(diffChecked[id] ? styles.diffChkOn : {})}}
                    onClick={() => setDiffChecked(prev => ({...prev, [id]: !prev[id]}))}>
                    {diffChecked[id] && '✓'}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={styles.diffName}>{orig.case_name} <span style={styles.diffCo}>{orig.customer}</span></div>
                    <div style={styles.diffRows}>
                      {changed.book_amount !== orig.book_amount && <DiffRow field="금액" before={fmtK(orig.book_amount)} after={fmtK(changed.book_amount)} />}
                      {changed.probability !== orig.probability && <DiffRow field="확도" before={orig.probability+'%'} after={changed.probability+'%'} />}
                      {changed.quarter !== orig.quarter && <DiffRow field="분기" before={orig.quarter} after={changed.quarter} />}
                      {changed.status !== orig.status && <DiffRow field="상태" before={orig.status} after={changed.status} />}
                      {(simChildren[id]||[]).length > 0 && <DiffRow field="파생딜" before="없음" after={`${simChildren[id].length}건 child`} />}
                    </div>
                  </div>
                </div>
              )
            })}
            <div style={styles.diffFoot}>
              <input style={styles.commitInp} value={commitMsg} onChange={e => setCommitMsg(e.target.value)}
                placeholder="커밋 메시지 (예: 주간회의 반영 — 25Q1 조정)" />
              <button style={styles.btnCommit} onClick={doCommit}>커밋 적용</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── KPI 카드 ──────────────────────────────────────
function KpiCard({ dot, label, value, sub, sim, fmtK, isGap, achieveRate }) {
  const gapColor = isGap ? (achieveRate >= 90 ? '#4ade80' : achieveRate >= 70 ? '#fbbf24' : '#f87171') : null
  return (
    <div style={styles.kpi}>
      <div style={styles.kpiTop}>
        <div style={{...styles.kpiDot, background: gapColor || dot}} />
        <span style={styles.kpiLabel}>{label}</span>
      </div>
      <div style={{...styles.kpiVal, color: gapColor || '#f0f0f0'}}>{value}</div>
      <div style={styles.kpiSub}>{sub}</div>
      {sim && (
        <div style={styles.kpiSim}>
          <span style={styles.simBadge}>시뮬</span>
          <span style={styles.simVal}>{sim.value}</span>
        </div>
      )}
    </div>
  )
}

// ── 딜 행 ─────────────────────────────────────────
function DealRow({ deal, orig, isSim, isOpen, mode, fmtK, onToggle }) {
  const st = STATUS_STYLE[deal.status] || STATUS_STYLE.active
  const ct = CATEGORY_STYLE[deal.category] || CATEGORY_STYLE.Pick
  const amtChanged = isSim && deal.book_amount !== orig.book_amount
  const confPct = deal.probability || 0
  const confColor = confPct >= 100 ? '#4ade80' : confPct >= 60 ? '#60a5fa' : confPct >= 30 ? '#fbbf24' : '#4b5563'
  return (
    <tr style={{...styles.tr, ...(isSim ? styles.trSim : {}), ...(isOpen ? styles.trOpen : {})}}
      onClick={mode==='sim' ? onToggle : undefined}
      onMouseEnter={e => { if(!isOpen) e.currentTarget.style.background = '#1a1a1a' }}
      onMouseLeave={e => { e.currentTarget.style.background = isSim ? '#161820' : 'transparent' }}>
      <td style={styles.td}><span style={{...styles.badge, background:st.bg, color:st.color}}>{st.label}</span></td>
      <td style={styles.td}><span style={{...styles.badge, background:ct.bg, color:ct.color}}>{deal.category}</span></td>
      <td style={styles.td}>
        <div style={styles.caseName}>{deal.case_name}</div>
        <div style={styles.caseSub}>{deal.customer}</div>
      </td>
      <td style={styles.td}><span style={styles.tagSmall}>{deal.product_cat}</span></td>
      <td style={styles.td}><span style={styles.tagSmall}>{deal.country}</span></td>
      <td style={{...styles.td, textAlign:'right'}}>
        {amtChanged ? <>
          <span style={styles.amtStrike}>{fmtK(orig.book_amount)}</span>
          <span style={styles.amtNew}>{fmtK(deal.book_amount)}</span>
        </> : <span style={styles.amtNormal}>{fmtK(deal.book_amount)}</span>}
      </td>
      <td style={{...styles.td, textAlign:'right'}}>
        <span style={styles.amtNormal}>{fmtK(deal.reflected_amount || Math.round((deal.book_amount * deal.probability)/100))}</span>
      </td>
      <td style={styles.td}>
        <div style={styles.confWrap}>
          <div style={styles.confBg}><div style={{...styles.confFill, width:confPct+'%', background:confColor}} /></div>
          <span style={{fontSize:11, color:'#9ca3af'}}>{confPct}%</span>
        </div>
      </td>
      <td style={styles.td}><span style={styles.ownerChip}>{deal.created_by}</span></td>
      <td style={styles.td}><span style={styles.quarterChip}>{deal.quarter}</span></td>
      <td style={styles.td}>
        {mode==='sim' && <span style={{...styles.chevron, transform: isOpen ? 'rotate(180deg)' : 'none'}}>▾</span>}
        {isSim && <span style={styles.simTag}>수정</span>}
      </td>
    </tr>
  )
}

// ── 인라인 편집 패널 ──────────────────────────────
function EditPanel({ deal, fmtK, quarters, owners, onApply, onCancel, onAddChild }) {
  const [amt, setAmt] = useState(deal.book_amount || 0)
  const [conf, setConf] = useState(deal.probability || 0)
  const [quarter, setQuarter] = useState(deal.quarter || '')
  const [status, setStatus] = useState(deal.status || 'active')
  const [children, setChildren] = useState([])

  const reflect = Math.round(amt * conf / 100)

  const STATUS_OPTS = [
    ['active','진행','#60a5fa'],['won','Won','#4ade80'],
    ['drop','Drop','#f87171'],['pending','대기','#fbbf24']
  ]

  return (
    <div style={styles.editPanel}>
      <div style={styles.editGrid}>
        <div style={styles.editField}>
          <label style={styles.editLabel}>계약금액 (K KRW)</label>
          <input style={styles.editInput} type="number" value={amt} step={1000}
            onChange={e => setAmt(Number(e.target.value))} />
          <span style={styles.editHint}>반영: {fmtK(reflect)}</span>
        </div>
        <div style={styles.editField}>
          <label style={styles.editLabel}>확도 (%)</label>
          <input style={styles.editInput} type="number" value={conf} min={0} max={100}
            onChange={e => setConf(Number(e.target.value))} />
        </div>
        <div style={styles.editField}>
          <label style={styles.editLabel}>분기</label>
          <select style={styles.editSelect} value={quarter} onChange={e => setQuarter(e.target.value)}>
            {quarters.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div style={styles.editField}>
          <label style={styles.editLabel}>상태</label>
          <div style={styles.statusRow}>
            {STATUS_OPTS.map(([val,label,color]) => (
              <button key={val} style={{...styles.statusBtn, ...(status===val ? {borderColor:color, color:color, background:color+'18'} : {})}}
                onClick={() => setStatus(val)}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* 파생 딜 */}
      <button style={styles.deriveBtn} onClick={() => setChildren(prev => [...prev, {amt:0, conf:40, quarter:quarters[0]||'2025-Q1'}])}>
        + 파생 딜 추가 (child)
      </button>
      {children.map((c, i) => (
        <div key={i} style={styles.childCard}>
          <div style={styles.childHeader}>
            <span style={styles.childBadge}>child {i+1}</span>
            <button style={styles.btnRm} onClick={() => setChildren(prev => prev.filter((_,j)=>j!==i))}>삭제</button>
          </div>
          <div style={styles.childGrid}>
            <div style={styles.editField}>
              <label style={styles.editLabel}>금액 (K)</label>
              <input style={styles.editInput} type="number" value={c.amt}
                onChange={e => setChildren(prev => prev.map((x,j) => j===i ? {...x,amt:Number(e.target.value)} : x))} />
            </div>
            <div style={styles.editField}>
              <label style={styles.editLabel}>분기</label>
              <select style={styles.editSelect} value={c.quarter}
                onChange={e => setChildren(prev => prev.map((x,j) => j===i ? {...x,quarter:e.target.value} : x))}>
                {[...quarters,'2026-Q3','2026-Q4','2027-Q1'].map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
            <div style={styles.editField}>
              <label style={styles.editLabel}>확도 (%)</label>
              <input style={styles.editInput} type="number" value={c.conf} min={0} max={100}
                onChange={e => setChildren(prev => prev.map((x,j) => j===i ? {...x,conf:Number(e.target.value)} : x))} />
            </div>
          </div>
        </div>
      ))}
      {children.length > 0 && (() => {
        const childSum = children.reduce((s,c) => s+c.amt, 0)
        const total = amt + childSum
        const orig = deal.book_amount || 0
        const ok = Math.abs(total - orig) < 1
        return (
          <div style={styles.splitCheck}>
            <span style={{ color:'#9ca3af', fontSize:12 }}>parent {(amt||0).toLocaleString()} + child {childSum.toLocaleString()} = {total.toLocaleString()}</span>
            <span style={{ color: ok ? '#4ade80' : '#f87171', fontWeight:500, fontSize:12 }}>{ok ? '✓ 원본 일치' : `✗ 원본 ${orig.toLocaleString()} 불일치`}</span>
          </div>
        )
      })()}

      <div style={styles.editFoot}>
        <span style={{ fontSize:11, color:'#6b7280' }}>커밋 전까지 실제 DB 불변</span>
        <div style={{ display:'flex', gap:8 }}>
          <button style={styles.btnCancel} onClick={onCancel}>취소</button>
          <button style={styles.btnApply} onClick={() => { children.forEach(c => onAddChild(c)); onApply({book_amount:amt, probability:conf, quarter, status}) }}>
            시뮬에 반영
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Child 행 ──────────────────────────────────────
function ChildRow({ child, deal, fmtK }) {
  return (
    <tr style={{ background:'#111318' }}>
      <td style={styles.td}><span style={{...styles.badge, background:'#1e1a35', color:'#a78bfa', fontSize:10}}>child</span></td>
      <td style={styles.td} />
      <td style={styles.td}>
        <div style={{ paddingLeft:16 }}>
          <span style={{ fontSize:11, color:'#6b7280', marginRight:6 }}>↳</span>
          <span style={styles.caseName}>{deal.case_name}</span>
          <div style={{...styles.caseSub, color:'#7c6db0'}}>잔여분</div>
        </div>
      </td>
      <td style={styles.td} />
      <td style={styles.td} />
      <td style={{...styles.td, textAlign:'right', color:'#a78bfa', fontWeight:500}}>{fmtK(child.amt)}</td>
      <td style={{...styles.td, textAlign:'right', color:'#a78bfa'}}>{fmtK(Math.round(child.amt*child.conf/100))}</td>
      <td style={styles.td}><span style={{ fontSize:11, color:'#9ca3af' }}>{child.conf}%</span></td>
      <td style={styles.td}><span style={styles.ownerChip}>{deal.created_by}</span></td>
      <td style={{...styles.td, color:'#a78bfa', fontWeight:500}}>{child.quarter}</td>
      <td style={styles.td} />
    </tr>
  )
}

// ── 분기 범위 선택기 ──────────────────────────────
function QuarterRangePicker({ quarters, range, onChange }) {
  if (quarters.length === 0) return <span style={{ fontSize:12, color:'#6b7280' }}>분기 데이터 없음</span>
  const pct = i => quarters.length <= 1 ? 0 : (i / (quarters.length - 1)) * 100
  return (
    <div style={styles.qrWrap}>
      <span style={styles.qrLabel}>기간</span>
      <div style={styles.qrTrackWrap}>
        <div style={styles.qrTrack}>
          <div style={{...styles.qrFill, left:pct(range.start)+'%', width:(pct(range.end)-pct(range.start))+'%'}} />
          {[range.start, range.end].map((idx, ti) => (
            <input key={ti} type="range" min={0} max={quarters.length-1} value={idx} step={1}
              style={styles.qrThumb}
              onChange={e => {
                const v = Number(e.target.value)
                if (ti===0) onChange({ start: Math.min(v, range.end), end: range.end })
                else onChange({ start: range.start, end: Math.max(v, range.start) })
              }} />
          ))}
        </div>
        <div style={styles.qrLabels}>
          {quarters.map((q, i) => (
            <span key={q} style={{...styles.qrQLbl, ...(i>=range.start&&i<=range.end ? styles.qrQLblOn : {})}}>
              {q.replace('20','')}
            </span>
          ))}
        </div>
      </div>
      <span style={styles.qrResult}>{quarters[range.start]} – {quarters[range.end]}</span>
    </div>
  )
}

// ── Diff 유틸 ─────────────────────────────────────
function DiffRow({ field, before, after }) {
  return (
    <div style={styles.diffRow}>
      <span style={styles.diffField}>{field}</span>
      <span style={styles.diffBefore}>{before}</span>
      <span style={{ color:'#4b5563', fontSize:11 }}>→</span>
      <span style={styles.diffAfter}>{after}</span>
    </div>
  )
}

// ── 스타일 ────────────────────────────────────────
const styles = {
  root: { minHeight:'100vh', background:'#0a0a0a', color:'#f0f0f0', fontFamily:"'Geist', sans-serif" },
  loadWrap: { minHeight:'100vh', background:'#0a0a0a', display:'flex', alignItems:'center', justifyContent:'center', gap:12, flexDirection:'column' },
  loadDot: { width:8, height:8, borderRadius:'50%', background:'#7c3aed', animation:'pulse 1s infinite' },
  loadTxt: { fontSize:14, color:'#6b7280' },

  // nav
  nav: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', height:52, background:'#111111', borderBottom:'1px solid #1f1f1f' },
  navLeft: { display:'flex', alignItems:'center', gap:20 },
  logo: { fontSize:15, fontWeight:600, color:'#f0f0f0', letterSpacing:'-0.02em' },
  logoAccent: { color:'#7c3aed' },
  modeTabs: { display:'flex', background:'#1a1a1a', borderRadius:8, padding:3, gap:2 },
  modeTab: { fontSize:12, padding:'4px 14px', borderRadius:6, border:'none', background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif", transition:'all .15s' },
  modeTabActive: { background:'#222', color:'#f0f0f0', fontWeight:500 },
  modeTabSimActive: { background:'#1e1635', color:'#a78bfa', fontWeight:500 },
  navRight: { display:'flex', alignItems:'center', gap:10 },

  // ccy
  ccyWrap: { display:'flex', alignItems:'center', gap:6, background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:8, padding:'4px 10px' },
  ccyLabel: { fontSize:11, color:'#6b7280' },
  ccySel: { fontSize:12, fontWeight:500, color:'#f0f0f0', border:'none', background:'transparent', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
  rateDot: { width:6, height:6, borderRadius:'50%' },
  rateLabel: { fontSize:10, color:'#6b7280' },
  avatar: { width:28, height:28, borderRadius:'50%', background:'#1e1635', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:500, color:'#a78bfa' },
  userName: { fontSize:12, color:'#6b7280' },

  // sim banner
  simBanner: { background:'#1c1400', borderBottom:'1px solid #3d2e00', padding:'9px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 },
  simBannerLeft: { display:'flex', alignItems:'center', gap:10 },
  simPulse: { width:7, height:7, borderRadius:'50%', background:'#fbbf24' },
  simBannerTitle: { fontSize:12, fontWeight:500, color:'#fcd34d' },
  simBannerSub: { fontSize:11, color:'#92740a' },
  chgPill: { fontSize:11, background:'#3d2e00', color:'#fbbf24', padding:'2px 8px', borderRadius:20, fontWeight:500 },
  btnDiscard: { fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid #3d2e00', background:'transparent', color:'#92740a', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
  btnDiff: { fontSize:11, padding:'4px 12px', borderRadius:6, border:'none', background:'#7c3aed', color:'#f0f0f0', cursor:'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" },

  // toolbar
  toolbar: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 24px', background:'#0f0f0f', borderBottom:'1px solid #1f1f1f', gap:12, flexWrap:'wrap' },
  toolbarLeft: { display:'flex', alignItems:'center', gap:10 },
  ownerSel: { fontSize:12, padding:'5px 10px', borderRadius:6, border:'1px solid #2a2a2a', background:'#1a1a1a', color:'#f0f0f0', fontFamily:"'Geist', sans-serif" },
  modeLabel: { fontSize:11, color:'#6b7280' },

  // body
  body: { padding:'16px 24px', display:'flex', flexDirection:'column', gap:12 },

  // kpi
  kpiRow: { display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:10 },
  kpi: { background:'#111111', border:'1px solid #1f1f1f', borderRadius:10, padding:'14px 16px' },
  kpiTop: { display:'flex', alignItems:'center', gap:6, marginBottom:5 },
  kpiDot: { width:6, height:6, borderRadius:'50%' },
  kpiLabel: { fontSize:11, color:'#6b7280' },
  kpiVal: { fontSize:22, fontWeight:500, lineHeight:1.2, color:'#f0f0f0' },
  kpiSub: { fontSize:11, color:'#4b5563', marginTop:3 },
  kpiSim: { display:'flex', alignItems:'center', gap:6, marginTop:6, paddingTop:6, borderTop:'1px dashed #2a2a2a' },
  simBadge: { fontSize:10, background:'#2e1a1a', color:'#f87171', padding:'1px 5px', borderRadius:3, fontWeight:500 },
  simVal: { fontSize:13, fontWeight:500, color:'#f87171' },

  // table
  tblCard: { background:'#111111', border:'1px solid #1f1f1f', borderRadius:10, overflow:'hidden' },
  tblTop: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 16px', borderBottom:'1px solid #1f1f1f' },
  tblTitle: { fontSize:13, fontWeight:500, color:'#f0f0f0' },
  simHint: { fontSize:11, color:'#92740a' },
  tbl: { width:'100%', borderCollapse:'collapse', tableLayout:'fixed' },
  th: { fontSize:11, fontWeight:500, color:'#4b5563', padding:'7px 14px', borderBottom:'1px solid #1f1f1f', background:'#0d0d0d', textAlign:'left', whiteSpace:'nowrap' },
  td: { fontSize:12, color:'#d1d5db', padding:'10px 14px', borderBottom:'1px solid #161616', verticalAlign:'middle' },
  tr: { transition:'background .1s', cursor:'default' },
  trSim: { background:'#161820' },
  trOpen: { background:'#161820' },
  badge: { display:'inline-block', fontSize:11, padding:'2px 7px', borderRadius:4, fontWeight:500 },
  caseName: { fontSize:12, fontWeight:500, color:'#e5e7eb', marginBottom:2 },
  caseSub: { fontSize:11, color:'#6b7280' },
  tagSmall: { fontSize:10, padding:'1px 6px', borderRadius:3, background:'#1a1a1a', color:'#9ca3af', border:'1px solid #2a2a2a' },
  amtNormal: { fontSize:12, color:'#d1d5db' },
  amtStrike: { fontSize:10, textDecoration:'line-through', color:'#4b5563', display:'block', textAlign:'right' },
  amtNew: { fontSize:12, fontWeight:500, color:'#4ade80', display:'block', textAlign:'right' },
  confWrap: { display:'flex', alignItems:'center', gap:6 },
  confBg: { width:44, height:3, background:'#2a2a2a', borderRadius:2, overflow:'hidden' },
  confFill: { height:'100%', borderRadius:2, transition:'width .3s' },
  ownerChip: { fontSize:11, padding:'2px 7px', borderRadius:4, background:'#1a1a1a', color:'#9ca3af' },
  quarterChip: { fontSize:11, color:'#6b7280' },
  chevron: { fontSize:12, color:'#4b5563', transition:'transform .2s', display:'inline-block' },
  simTag: { fontSize:9, background:'#3d2e00', color:'#fbbf24', padding:'1px 4px', borderRadius:3, marginLeft:4 },

  // edit panel
  editPanel: { background:'#0d0d12', borderTop:'1px solid #2a1f5c', padding:'16px 20px' },
  editGrid: { display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:12, marginBottom:12 },
  editField: { display:'flex', flexDirection:'column', gap:4 },
  editLabel: { fontSize:11, color:'#6b7280' },
  editInput: { fontSize:12, padding:'7px 9px', borderRadius:6, border:'1px solid #2a2a2a', background:'#111', color:'#f0f0f0', fontFamily:"'Geist', sans-serif", outline:'none' },
  editSelect: { fontSize:12, padding:'7px 9px', borderRadius:6, border:'1px solid #2a2a2a', background:'#111', color:'#f0f0f0', fontFamily:"'Geist', sans-serif" },
  editHint: { fontSize:11, color:'#6b7280' },
  statusRow: { display:'flex', gap:5, flexWrap:'wrap' },
  statusBtn: { fontSize:11, padding:'3px 9px', borderRadius:5, border:'1px solid #2a2a2a', background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif", transition:'all .1s' },
  deriveBtn: { fontSize:11, padding:'5px 12px', borderRadius:6, border:'1px dashed #2a1f5c', background:'transparent', color:'#7c3aed', cursor:'pointer', fontFamily:"'Geist', sans-serif", marginBottom:10 },
  childCard: { background:'#0a0a14', border:'1px solid #2a1f5c', borderRadius:7, padding:'10px 12px', marginBottom:8 },
  childHeader: { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 },
  childBadge: { fontSize:10, padding:'1px 6px', borderRadius:4, background:'#1e1635', color:'#a78bfa', fontWeight:500 },
  childGrid: { display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:8 },
  btnRm: { fontSize:10, padding:'2px 7px', borderRadius:4, border:'1px solid #2a2a2a', background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
  splitCheck: { display:'flex', alignItems:'center', justifyContent:'space-between', background:'#111', border:'1px solid #1f1f1f', borderRadius:6, padding:'7px 12px', marginBottom:10, fontSize:12 },
  editFoot: { display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:12 },
  btnCancel: { fontSize:12, padding:'5px 14px', borderRadius:6, border:'1px solid #2a2a2a', background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
  btnApply: { fontSize:12, padding:'5px 16px', borderRadius:6, border:'none', background:'#7c3aed', color:'#f0f0f0', cursor:'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" },

  // quarter picker
  qrWrap: { display:'flex', alignItems:'center', gap:10, background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:8, padding:'6px 12px' },
  qrLabel: { fontSize:11, color:'#6b7280', whiteSpace:'nowrap' },
  qrTrackWrap: { display:'flex', flexDirection:'column', gap:4, minWidth:180 },
  qrTrack: { position:'relative', height:4, background:'#2a2a2a', borderRadius:2 },
  qrFill: { position:'absolute', height:'100%', background:'#7c3aed', borderRadius:2, top:0, pointerEvents:'none' },
  qrThumb: { position:'absolute', width:'100%', height:'100%', top:0, left:0, opacity:0, cursor:'pointer', margin:0 },
  qrLabels: { display:'flex', justifyContent:'space-between' },
  qrQLbl: { fontSize:9, color:'#4b5563' },
  qrQLblOn: { color:'#a78bfa', fontWeight:500 },
  qrResult: { fontSize:12, fontWeight:500, color:'#d1d5db', whiteSpace:'nowrap' },

  // diff modal
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 },
  diffModal: { background:'#111', border:'1px solid #2a1f5c', borderRadius:12, width:'100%', maxWidth:540, overflow:'hidden' },
  diffHeader: { background:'#1e1635', padding:'13px 18px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #2a1f5c' },
  diffTitle: { fontSize:13, fontWeight:500, color:'#c4b5fd' },
  diffClose: { fontSize:20, color:'#7c3aed', cursor:'pointer', background:'none', border:'none', lineHeight:1, fontFamily:"'Geist', sans-serif" },
  diffItem: { padding:'13px 18px', borderBottom:'1px solid #1f1f1f', display:'flex', gap:10, alignItems:'flex-start' },
  diffChk: { width:16, height:16, borderRadius:4, border:'1px solid #2a2a2a', background:'#111', flexShrink:0, marginTop:1, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', fontSize:10, color:'#f0f0f0' },
  diffChkOn: { background:'#7c3aed', borderColor:'#7c3aed' },
  diffName: { fontSize:12, fontWeight:500, color:'#e5e7eb', marginBottom:5 },
  diffCo: { fontSize:11, background:'#1a1a1a', color:'#6b7280', padding:'1px 6px', borderRadius:3, marginLeft:5 },
  diffRows: { display:'flex', flexDirection:'column', gap:3 },
  diffRow: { display:'flex', alignItems:'center', gap:6, fontSize:11 },
  diffField: { color:'#6b7280', width:44, flexShrink:0 },
  diffBefore: { color:'#f87171', textDecoration:'line-through' },
  diffAfter: { color:'#4ade80', fontWeight:500 },
  diffFoot: { padding:'12px 18px', background:'#0d0d0d', display:'flex', gap:8, alignItems:'center' },
  commitInp: { flex:1, fontSize:12, padding:'7px 10px', borderRadius:6, border:'1px solid #2a2a2a', background:'#111', color:'#f0f0f0', fontFamily:"'Geist', sans-serif" },
  btnCommit: { fontSize:12, padding:'7px 16px', borderRadius:6, border:'none', background:'#7c3aed', color:'#f0f0f0', cursor:'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif", whiteSpace:'nowrap' },
}
