'use client'

import { useEffect, useState } from 'react'

// Public franchise abbreviations survive warehouse ID reassignment.
const KEY = 'hardwood-following-v2'
function read(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && /^[A-Z]{2,4}$/.test(v)))].slice(0, 30) : []
  } catch { return [] }
}

export function useFollowing() {
  const [following, setFollowing] = useState<string[]>([])
  useEffect(() => {
    const sync = () => setFollowing(read())
    sync()
    window.addEventListener('storage', sync)
    window.addEventListener('hardwood-following', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('hardwood-following', sync)
    }
  }, [])
  function toggle(abbreviation: string) {
    const next = following.includes(abbreviation) ? following.filter(v => v !== abbreviation) : [...following, abbreviation]
    setFollowing(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
      window.dispatchEvent(new Event('hardwood-following'))
    } catch { /* Following still works for this visit when storage is blocked. */ }
  }
  return { following, toggle }
}
