import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabase'
import { getAlias, getWeekLabel, getPriorityGroup, PRIORITY_LABEL, STATUS_STYLE } from './constants'

// ── 공용 DealDrawer ───────────────────────────────────
// item: { type: 'deal' | 'opp', data: {...} }
export default function DealDrawer({ item, darkMode, session, fmtK, onClose, onPromote, onDrop, onPriorityChange, onRefreshDeals, onRefreshOpps }) {
  const { type, data } = item
  const s = useMemo(() => getDrawerStyles(darkMode), [darkMode])

  const [comments, setComments]       = useState([])
  const [loadingC, setLoadingC]       = useState(true)
  const [commentOpen, setCommentOpen] = useState(false)

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
      <div style={s.panel}>

        {/* ── 헤더 ── */}
        <div style={s.header}>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={s.headerTitle}>
              {type === 'deal' ? data.case_name : data.title}
            </p>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginTop:6 }}>
              {type === 'deal' ? (
                <>
                  <StatusBadge status={data.status} />
                  <span style={s.headerMeta}>{data.customer} · {fmtK(data.book_amount)} · {data.quarter} · {data.created_by}</span>
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
                <button style={s.btnPromote} onClick={() => onPromote && onPromote(data.id)}>↑ 정식딜 승격</button>
                <button style={s.btnDrop} onClick={() => onDrop && onDrop(data.id)}>드랍</button>
              </>
            )}
            <button style={s.btnClose} onClick={onClose}>×</button>
          </div>
        </div>

        {/* ── 딜 상세 정보 ── */}
        <div style={s.infoRow}>
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

        {/* ── + 코멘트 버튼 ── */}
        <div style={s.commentBarWrap}>
          <button style={s.btnComment} onClick={() => setCommentOpen(true)}>+ 코멘트 추가</button>
        </div>

        {/* ── 타임라인 ── */}
        <div style={s.timeline}>
          <p style={s.timelineLabel}>타임라인</p>

          {loadingC ? (
            <p style={s.emptyText}>로딩 중...</p>
          ) : comments.length === 0 ? (
            <p style={s.emptyText}>아직 기록이 없어요. 코멘트를 추가해보세요!</p>
          ) : (
            Object.entries(grouped).map(([week, items]) => (
              <WeekGroup
                key={week}
                week={week}
                items={items}
                darkMode={darkMode}
                onRefresh={loadComments}
              />
            ))
          )}
        </div>
      </div>

      {/* ── 코멘트 모달 ── */}
      {commentOpen && (
        <CommentModal
          entityType={type}
          entityId={data.id}
          isOpp={type === 'opp'}
          currentPriority={data.priority}
          darkMode={darkMode}
          session={session}
          onClose={() => setCommentOpen(false)}
          onSaved={() => {
            setCommentOpen(false)
            loadComments()
            if (type === 'opp' && onRefreshOpps) onRefreshOpps()
          }}
          onPriorityChange={onPriorityChange}
        />
      )}
    </>
  )
}

// ── 주차 그룹 ─────────────────────────────────────────
function WeekGroup({ week, items, darkMode, onRefresh }) {
  const [showRaw, setShowRaw]   = useState(false)
  const [editingId, setEditingId] = useState(null)
  const s = useMemo(() => getDrawerStyles(darkMode), [darkMode])

  return (
    <div style={{ marginBottom: 22 }}>

      {/* 주차 헤더 */}
      <div style={s.weekHeader}>
        <span style={s.weekBadge}>{week}</span>
        <div style={s.weekLine} />
        <div style={s.aiBox}>
          <span style={{ fontSize:13 }}>✦</span>
          <span style={s.aiText}>
            {items[0]?.content_summary || 'AI 요약 준비 중'}
          </span>
          <button style={s.rawBtn} onClick={() => setShowRaw(v => !v)}>
            {showRaw ? '요약보기' : '원본보기'}
          </button>
        </div>
        <div style={s.weekLine} />
      </div>

      {/* 데일리 항목들 */}
      {items.map((item, i) => (
        <div key={item.id} style={{ display:'flex', gap:10, paddingBottom: i < items.length-1 ? 14 : 0 }}>
          {/* 타임라인 점 + 선 */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', width:12, flexShrink:0 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background: i===0 ? '#534AB7' : darkMode?'#374151':'#d1d5db', flexShrink:0, marginTop:3 }} />
            {i < items.length-1 && <div style={{ width:1, flex:1, background: darkMode?'#1f1f1f':'#e2e2e2', minHeight:20 }} />}
          </div>

          {/* 내용 */}
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
              <span style={s.dateLabel}>
                {new Date(item.created_at).toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit' })}
                <span style={s.timeLabel}>
                  {' '}{new Date(item.created_at).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' })}
                </span>
                <span style={s.authorLabel}> · {item.author}</span>
              </span>
              <button style={s.editBtn}
                onClick={() => setEditingId(editingId === item.id ? null : item.id)}>
                편집
              </button>
            </div>

            {/* 편집 모드 */}
            {editingId === item.id ? (
              <InlineEditor
                item={item}
                darkMode={darkMode}
                onCancel={() => setEditingId(null)}
                onSaved={() => { setEditingId(null); onRefresh() }}
              />
            ) : (
              <p style={s.commentText}>
                {showRaw ? item.content_raw : (item.content_summary || item.content_raw)}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 인라인 편집기 ─────────────────────────────────────
function InlineEditor({ item, darkMode, onCancel, onSaved }) {
  const [text, setText] = useState(item.content_raw || '')
  const [saving, setSaving] = useState(false)
  const inp = { fontSize:12, padding:'8px 10px', borderRadius:6, border:`1px solid ${darkMode?'#2a2a2a':'#e5e7eb'}`, background:darkMode?'#1a1a1a':'#f9fafb', color:darkMode?'#f0f0f0':'#111', fontFamily:"'Geist', sans-serif", outline:'none', width:'100%', boxSizing:'border-box', resize:'none', lineHeight:1.6 }

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('timeline_comments').update({ content_raw: text, content_summary: null }).eq('id', item.id)
    setSaving(false)
    onSaved()
  }

  return (
    <div style={{ marginTop:4 }}>
      <textarea rows={3} style={inp} value={text} onChange={e => setText(e.target.value)} />
      <div style={{ display:'flex', gap:6, justifyContent:'flex-end', marginTop:6 }}>
        <button onClick={onCancel} style={{ fontSize:11, padding:'3px 10px', borderRadius:5, border:`1px solid ${darkMode?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>취소</button>
        <button onClick={handleSave} disabled={saving} style={{ fontSize:11, padding:'3px 10px', borderRadius:5, border:'none', background:'#7c3aed', color:'#f0f0f0', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>{saving ? '저장 중...' : '저장'}</button>
      </div>
    </div>
  )
}

// ── 코멘트 모달 ───────────────────────────────────────
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 200,
          messages: [{ role:'user', content: `다음 영업 활동 기록을 2-3문장으로 간결하게 요약해줘. 구어체를 정제된 업무 문체로 바꿔줘:\n\n${raw}` }]
        })
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
      entity_type:     entityType,
      entity_id:       entityId,
      author:          alias,
      content_raw:     raw,
      content_summary: aiPreview || null,
      week_label:      getWeekLabel(new Date()),
      comment_date:    new Date().toISOString().split('T')[0],
    })
    if (isOpp && onPriorityChange) await onPriorityChange(entityId, priority)
    setSaving(false)
    onSaved()
  }

  const dk  = darkMode
  const bg  = dk?'#111':'#fff', br = dk?'#2a1f5c':'#e5e7eb', tx = dk?'#f0f0f0':'#111'
  const inp = { fontSize:13, padding:'10px 12px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:dk?'#1a1a1a':'#f9fafb', color:tx, fontFamily:"'Geist', sans-serif", outline:'none', width:'100%', boxSizing:'border-box', resize:'none', lineHeight:1.7 }

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
              <button
                style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, padding:'3px 10px', borderRadius:99, border:'1px solid #AFA9EC', background:'#EEEDFE', color:'#3C3489', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                onClick={handleAI} disabled={aiLoading}>
                <span style={{ fontSize:13 }}>✦</span>
                <span>{aiLoading ? 'AI 정리 중...' : 'AI로 정리'}</span>
              </button>
            </div>
            <textarea rows={4} style={inp}
              placeholder={'자유롭게 입력하세요. 구어체도 괜찮아요.\n예) 오늘 유플러스 담당자한테 연락했는데 투심이 2주 더 걸릴 것 같다고 함'}
              value={raw} onChange={e => setRaw(e.target.value)} />

            {/* AI 요약 미리보기 */}
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
                    style={{ fontSize:12, padding:'6px 20px', borderRadius:99, border:`1.5px solid ${currentGroup===val ? color : dk?'#2a2a2a':'#e5e7eb'}`, background:currentGroup===val ? pbg : 'transparent', color:currentGroup===val ? color : '#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif", fontWeight:currentGroup===val?500:400, transition:'all .15s' }}
                    onClick={() => setPriority(range[0])}>
                    {label}
                  </button>
                ))}
              </div>
              <p style={{ fontSize:11, color:'#6b7280', marginTop:6 }}>
                현재: {currentGroup.toUpperCase()} (우선순위 {priority}) — 저장 전 반드시 확인
              </p>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div style={{ padding:'12px 20px', borderTop:`1px solid ${br}`, display:'flex', justifyContent:'flex-end', gap:8, background:dk?'#0d0d0d':'#f9fafb' }}>
          <button onClick={onClose} style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>취소</button>
          <button onClick={handleSave} disabled={saving || !raw.trim()}
            style={{ fontSize:12, padding:'6px 18px', borderRadius:6, border:'none', background:saving||!raw.trim()?'#4c1d95':'#7c3aed', color:'#f0f0f0', cursor:saving||!raw.trim()?'not-allowed':'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" }}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 서브 컴포넌트들 ───────────────────────────────────
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
  const map = { 'Idea':{ bg:'#F1EFE8', color:'#444441' }, 'In Progress':{ bg:'#E6F1FB', color:'#0C447C' }, 'Forecast':{ bg:'#FAEEDA', color:'#633806' }, 'Promoted':{ bg:'#EAF3DE', color:'#27500A' }, 'Dropped':{ bg:'#FCEBEB', color:'#791F1F' } }
  const st = map[status] || map['Idea']
  return <span style={{ display:'inline-block', fontSize:11, padding:'2px 7px', borderRadius:4, fontWeight:500, background:st.bg, color:st.color }}>{status}</span>
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

// ── 드로어 스타일 ─────────────────────────────────────
function getDrawerStyles(dark) {
  const br = dark?'#1f1f1f':'#e2e2e2'
  const tx0 = dark?'#f0f0f0':'#111', tx1 = dark?'#6b7280':'#6b7280', tx2 = dark?'#d1d5db':'#374151'
  return {
    panel:         { position:'fixed', top:0, right:0, bottom:0, zIndex:201, width:'48%', minWidth:480, background:dark?'#111':'#fff', borderLeft:`1px solid ${br}`, display:'flex', flexDirection:'column', fontFamily:"'Geist', sans-serif", boxShadow:'-4px 0 24px rgba(0,0,0,0.12)' },
    header:        { padding:'14px 20px', borderBottom:`1px solid ${br}`, display:'flex', justifyContent:'space-between', alignItems:'flex-start' },
    headerTitle:   { fontSize:15, fontWeight:500, color:tx0 },
    headerMeta:    { fontSize:11, color:tx1 },
    infoRow:       { display:'flex', gap:20, padding:'10px 20px', borderBottom:`1px solid ${br}`, color:tx2, flexWrap:'wrap' },
    commentBarWrap:{ padding:'10px 20px', borderBottom:`1px solid ${br}`, display:'flex', justifyContent:'flex-end' },
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
