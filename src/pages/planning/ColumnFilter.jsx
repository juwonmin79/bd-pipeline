import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// ── props ─────────────────────────────────────────────
// label      : 헤더 텍스트
// align      : 'left' | 'center' | 'right'
// options    : string[]
// value      : string[] (선택된 값 배열, 빈 배열 = 전체)
// onChange   : (string[]) => void
// onSort     : (dir: 'asc'|'desc'|null) => void  (optional)
// sortDir    : 'asc'|'desc'|null
// thStyle    : <th> inline style 객체
// darkMode   : boolean
// filterable : boolean
// withSearch : boolean
// sortable   : boolean (default true)

export default function ColumnFilter({
  label,
  align = 'left',
  options = [],
  value = [],
  onChange,
  onSort,
  sortDir = null,
  thStyle,
  darkMode,
  filterable = true,
  withSearch = false,
  sortable = true,
}) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const [pos, setPos]       = useState({ top: 0, left: 0 })
  const thRef   = useRef(null)
  const dropRef = useRef(null)
  const dk = darkMode

  const isActive = Array.isArray(value) && value.length > 0
  const allChecked = !isActive

  const calcPos = () => {
    if (!thRef.current) return
    const rect = thRef.current.getBoundingClientRect()
    const dropW = 200
    let left = align === 'right'
      ? rect.right + window.scrollX - dropW
      : rect.left + window.scrollX
    const maxLeft = window.innerWidth - dropW - 8
    if (left > maxLeft) left = maxLeft
    setPos({ top: rect.bottom + window.scrollY + 2, left })
  }

  const handleOpen = (e) => {
    e.stopPropagation()
    calcPos()
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (
        thRef.current  && !thRef.current.contains(e.target) &&
        dropRef.current && !dropRef.current.contains(e.target)
      ) { setOpen(false); setSearch('') }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const h = () => calcPos()
    window.addEventListener('scroll', h, true)
    window.addEventListener('resize', h)
    return () => { window.removeEventListener('scroll', h, true); window.removeEventListener('resize', h) }
  }, [open])

  if (!filterable) {
    // 정렬 전용 모드 — 클릭할 때마다 asc → desc → null 직접 토글, 드롭다운 없음
    const handleSortToggle = (e) => {
      e.stopPropagation()
      if (!onSort) return
      const next = sortDir === null ? 'asc' : sortDir === 'asc' ? 'desc' : null
      onSort(next)
    }
    return (
      <th style={{ ...thStyle, textAlign: align, userSelect: 'none', padding: 0 }}>
        <button
          onClick={handleSortToggle}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            width: '100%', padding: '8px 14px',
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: "'Geist', sans-serif", fontSize: 11, fontWeight: 500,
            color: sortDir ? '#7c3aed' : (thStyle?.color || (darkMode ? '#4b5563' : '#9ca3af')),
            justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
            whiteSpace: 'nowrap', transition: 'color .1s',
          }}
          onMouseEnter={e => { if (!sortDir) e.currentTarget.style.color = darkMode ? '#d1d5db' : '#111' }}
          onMouseLeave={e => { if (!sortDir) e.currentTarget.style.color = thStyle?.color || (darkMode ? '#4b5563' : '#9ca3af') }}
        >
          <span>{label}</span>
          <span style={{ fontSize: 10, color: sortDir ? '#7c3aed' : 'inherit', opacity: sortDir ? 1 : 0.4, fontWeight: sortDir ? 700 : 400 }}>
            {sortDir === 'asc' ? '↑' : sortDir === 'desc' ? '↓' : '↕'}
          </span>
        </button>
      </th>
    )
  }

  const toggleAll = () => onChange([])
  const toggleOpt = (opt) => {
    const arr = Array.isArray(value) ? value : []
    onChange(arr.includes(opt) ? arr.filter(v => v !== opt) : [...arr, opt])
  }

const visibleOpts = withSearch && !sortable
  ? (search ? options.filter(o => o?.toLowerCase().includes(search.toLowerCase())) : [])
  : withSearch && search
    ? options.filter(o => o?.toLowerCase().includes(search.toLowerCase()))
    : options

  const dropdown = open && createPortal(
    <div
      ref={dropRef}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', top: pos.top, left: pos.left, zIndex: 9999,
        background: dk ? '#1a1a1a' : '#ffffff',
        border: `0.5px solid ${dk ? '#2a2a2a' : '#d1d5db'}`,
        borderRadius: 10,
        boxShadow: dk ? '0 8px 24px rgba(0,0,0,0.5)' : '0 8px 24px rgba(0,0,0,0.1)',
        minWidth: 180, maxWidth: 240, overflow: 'hidden',
        fontFamily: "'Geist', sans-serif",
      }}
    >
      {/* 검색창 */}
      {withSearch && (
        <div style={{ padding: '8px 8px 4px' }}>
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="검색..."
            style={{
              width: '100%', boxSizing: 'border-box',
              fontSize: 11, padding: '5px 8px', borderRadius: 6,
              border: `0.5px solid ${dk ? '#2a2a2a' : '#e5e7eb'}`,
              background: dk ? '#111' : '#f5f5f7',
              color: dk ? '#f0f0f0' : '#111827',
              outline: 'none', fontFamily: "'Geist', sans-serif",
            }}
          />
        </div>
      )}

      {/* 정렬 섹션 — sortable=true일 때만 */}
      {sortable && onSort && (
        <div style={{ borderBottom: `0.5px solid ${dk ? '#2a2a2a' : '#f0f0f0'}`, padding: '4px 0' }}>
          <SortBtn label="↑ 오름차순" active={sortDir === 'asc'} dk={dk}
            onClick={() => { onSort(sortDir === 'asc' ? null : 'asc'); setOpen(false) }} />
          <SortBtn label="↓ 내림차순" active={sortDir === 'desc'} dk={dk}
            onClick={() => { onSort(sortDir === 'desc' ? null : 'desc'); setOpen(false) }} />
        </div>
      )}

      {/* 필터 목록
          - 검색 전용(withSearch && !sortable): 전체/구분선 없이 검색결과만
          - 일반: 전체 체크박스 + 구분선 + 목록
      */}
      <div style={{ maxHeight: 220, overflowY: 'auto', padding: '4px 0' }}>
        {!(withSearch && !sortable) && (
          <>
            <CheckRow label="전체" checked={allChecked} onClick={toggleAll} dk={dk} />
            <div style={{ height: '0.5px', background: dk ? '#2a2a2a' : '#f0f0f0', margin: '2px 0' }} />
          </>
        )}
        {visibleOpts.length === 0 && (withSearch && !sortable ? search : true) ? (
          <div style={{ fontSize: 11, padding: '8px 12px', color: '#6b7280' }}>결과 없음</div>
        ) : visibleOpts.map(opt => (
          <CheckRow
            key={opt} label={opt}
            checked={Array.isArray(value) && value.includes(opt)}
            onClick={() => { toggleOpt(opt); if (withSearch && !sortable) { setOpen(false); setSearch('') } }}
            dk={dk}
          />
        ))}
      </div>

      {/* 필터 초기화 */}
      {isActive && (
        <>
          <div style={{ height: '0.5px', background: dk ? '#2a2a2a' : '#f0f0f0' }} />
          <div
            onClick={() => { onChange([]); setOpen(false); setSearch('') }}
            style={{ fontSize: 11, padding: '7px 12px', cursor: 'pointer', color: '#f87171', textAlign: 'center' }}
            onMouseEnter={e => e.currentTarget.style.background = dk ? '#222' : '#fef2f2'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            필터 초기화
          </div>
        </>
      )}
    </div>,
    document.body
  )

  return (
    <th ref={thRef} style={{ ...thStyle, textAlign: align, userSelect: 'none', padding: 0 }}>
      <button
        onClick={handleOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          width: '100%', padding: '8px 14px',
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: "'Geist', sans-serif",
          fontSize: 11, fontWeight: 500,
          color: isActive ? '#7c3aed' : (thStyle?.color || (dk ? '#4b5563' : '#9ca3af')),
          justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
          whiteSpace: 'nowrap', transition: 'color .1s',
        }}
        onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = dk ? '#d1d5db' : '#111' }}
        onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = isActive ? '#7c3aed' : (thStyle?.color || (dk ? '#4b5563' : '#9ca3af')) }}
      >
        <span>{label}</span>
        {isActive && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#7c3aed', flexShrink: 0 }} />}
        {sortDir && <span style={{ fontSize: 10, color: '#7c3aed', fontWeight: 700 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
        <span style={{ fontSize: 9, opacity: isActive ? 1 : 0.4, color: isActive ? '#7c3aed' : 'inherit' }}>▾</span>
      </button>
      {dropdown}
    </th>
  )
}

function SortBtn({ label, active, onClick, dk }) {
  const [hover, setHover] = useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '6px 12px',
        background: active ? (dk ? '#1e1635' : '#f5f3ff') : hover ? (dk ? '#222' : '#f5f5f7') : 'transparent',
        border: 'none', cursor: 'pointer',
        fontSize: 12, fontFamily: "'Geist', sans-serif",
        color: active ? '#7c3aed' : (dk ? '#9ca3af' : '#6b7280'),
        fontWeight: active ? 500 : 400, transition: 'all .1s',
      }}
    >{label}</button>
  )
}

function CheckRow({ label, checked, onClick, dk }) {
  const [hover, setHover] = useState(false)
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', cursor: 'pointer', fontSize: 12,
        color: checked ? (dk ? '#e5e7eb' : '#111') : (dk ? '#9ca3af' : '#6b7280'),
        fontWeight: checked ? 500 : 400,
        background: checked ? (dk ? '#1e1635' : '#f5f3ff') : hover ? (dk ? '#222' : '#f5f5f7') : 'transparent',
        whiteSpace: 'nowrap', transition: 'background .1s',
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
        border: `1.5px solid ${checked ? '#7c3aed' : (dk ? '#4b5563' : '#d1d5db')}`,
        background: checked ? '#7c3aed' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all .1s',
      }}>
        {checked && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1, fontWeight: 700 }}>✓</span>}
      </div>
      <span>{label}</span>
    </div>
  )
}
