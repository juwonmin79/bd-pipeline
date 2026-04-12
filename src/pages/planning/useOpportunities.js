import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabase'
import { getAlias, getPriorityGroup } from './constants'

export function useOpportunities({ session, ownerFilter = 'all' }) {
  const [opportunities, setOpportunities] = useState([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState(null)

  const loadOpportunities = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('opportunities')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: true })
    if (error) { setError(error.message); setLoading(false); return }
    setOpportunities(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (session !== undefined) loadOpportunities()
  }, [session, loadOpportunities])

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('opportunities-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'opportunities' }, () => loadOpportunities())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [loadOpportunities])

  const myAlias = getAlias(session)

  // 내 오퍼튜니티만
  const myOpportunities = opportunities.filter(o => o.owner === myAlias)

  // 필터링
  const filteredOpportunities = opportunities.filter(o => {
    if (ownerFilter !== 'all' && o.owner !== ownerFilter) return false
    return true
  })

  // 중요도 그룹별 분류
  const grouped = {
    high:  filteredOpportunities.filter(o => getPriorityGroup(o.priority) === 'high'),
    mid:   filteredOpportunities.filter(o => getPriorityGroup(o.priority) === 'mid'),
    low:   filteredOpportunities.filter(o => getPriorityGroup(o.priority) === 'low'),
    dummy: filteredOpportunities.filter(o => getPriorityGroup(o.priority) === 'dummy'),
  }

  // 오퍼튜니티 추가
  const addOpportunity = async (payload) => {
    const { error } = await supabase.from('opportunities').insert({
      ...payload,
      owner: payload.owner || myAlias,
      is_active: true,
      created_at: new Date().toISOString(),
    })
    if (error) return { error }
    await loadOpportunities()
    return { error: null }
  }

  // 오퍼튜니티 수정
  const updateOpportunity = async (id, updates) => {
    const { error } = await supabase.from('opportunities').update(updates).eq('id', id)
    if (error) return { error }
    await loadOpportunities()
    return { error: null }
  }

  // 소프트 삭제
  const dropOpportunity = async (id) => {
    const { error } = await supabase.from('opportunities')
      .update({ is_active: false, status: 'Dropped' }).eq('id', id)
    if (error) return { error }
    await loadOpportunities()
    return { error: null }
  }

  // 정식딜로 승격
  const promoteOpportunity = async (id, dealId) => {
    const { error } = await supabase.from('opportunities').update({
      status: 'Promoted',
      promoted_deal_id: dealId,
    }).eq('id', id)
    if (error) return { error }
    await loadOpportunities()
    return { error: null }
  }

  // 중요도 변경
  const updatePriority = async (id, priority) => {
    return updateOpportunity(id, { priority })
  }

  return {
    opportunities,
    myOpportunities,
    filteredOpportunities,
    grouped,
    loading,
    error,
    loadOpportunities,
    addOpportunity,
    updateOpportunity,
    dropOpportunity,
    promoteOpportunity,
    updatePriority,
    myAlias,
  }
}
