import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabase'
import { FALLBACK_RATES, normalize, expandSearch, getAlias } from './constants'

export function useDeals({ session, mode = 'all', ownerFilter = 'all', quarterRange, categoryFilter = 'all', statusFilter = 'all', searchQuery = '' }) {
  const [deals, setDeals]           = useState([])
  const [owners, setOwners]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [quarters, setQuarters]     = useState([])

  const loadDeals = useCallback(async () => {
    setLoading(true)
    const [{ data, error }, { data: userData }] = await Promise.all([
      supabase.from('projects').select('*').eq('is_simulation', false).order('created_at', { ascending: true }),
      supabase.from('users').select('alias')
    ])
    if (error) { setError(error.message); setLoading(false); return }
    const rows = data || []
    setDeals(rows)
    setOwners((userData || []).map(u => u.alias).filter(Boolean))
    const qs = [...new Set(rows.map(d => d.quarter).filter(Boolean))].sort()
    setQuarters(qs)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (session !== undefined) loadDeals()
  }, [session, loadDeals])

  // Supabase Realtime — 다른 유저가 변경하면 자동 갱신
  useEffect(() => {
    const channel = supabase
      .channel('projects-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => loadDeals())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [loadDeals])

  // 필터링된 딜 목록
  const myAlias = getAlias(session)
  const filteredDeals = deals.filter(d => {
    if (mode === 'personal' && d.created_by !== myAlias) return false
    if (ownerFilter !== 'all' && d.created_by !== ownerFilter) return false
    if (quarterRange && quarters.length > 0) {
      const qi = quarters.indexOf(d.quarter)
      if (qi < quarterRange.start || qi > quarterRange.end) return false
    }
    if (categoryFilter !== 'all' && d.product_cat !== categoryFilter) return false
    if (statusFilter !== 'all' && d.status !== statusFilter) return false
    if (searchQuery.trim()) {
      const terms = expandSearch(searchQuery)
      const match = (s) => terms.some(t => normalize(s).includes(t))
      if (!match(d.case_name) && !match(d.customer)) return false
    }
    return true
  })

  // 집계
  const wonAmount      = filteredDeals.filter(d => d.status === 'won').reduce((s, d) => s + (d.book_amount || 0), 0)
  const activeAmount   = filteredDeals.filter(d => d.status === 'active').reduce((s, d) => s + Math.round((d.book_amount * d.probability) / 100), 0)
  const targetAmount   = filteredDeals.reduce((s, d) => s + (d.target_amount || 0), 0)
  const gap            = Math.max(0, targetAmount - activeAmount)
  const achieveRate    = targetAmount > 0 ? Math.round((activeAmount / targetAmount) * 100) : 0
  const productCats    = [...new Set(deals.map(d => d.product_cat).filter(Boolean))].sort()

  // 딜 업데이트 (시뮬레이션 커밋용)
  const commitDeal = async (id, updates) => {
    const { error } = await supabase.from('projects').update({
      ...updates,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) return { error }
    await loadDeals()
    return { error: null }
  }

  // 딜 추가
  const addDeal = async (payload) => {
    const { error } = await supabase.from('projects').insert({
      ...payload,
      is_simulation: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    if (error) return { error }
    await loadDeals()
    return { error: null }
  }

  return {
    deals,
    filteredDeals,
    owners,
    quarters,
    productCats,
    loading,
    error,
    loadDeals,
    commitDeal,
    addDeal,
    // 집계값
    wonAmount,
    activeAmount,
    targetAmount,
    gap,
    achieveRate,
    myAlias,
  }
}
