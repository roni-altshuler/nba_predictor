import fs from 'node:fs'
import path from 'node:path'

/** A generated forecast can be new while its underlying ingestion is stale. */
export function ingestionHealth(data: unknown, now = new Date()) {
  const unknown = { status: 'unknown', last_success_at: null } as const
  if (!data || typeof data !== 'object') return unknown
  const record = data as Record<string, unknown>
  if (record.source !== 'espn' || !['ok', 'unavailable'].includes(String(record.status))) return unknown
  // Season labels roll over in July, independently of the schedule window.
  const season = now.getUTCFullYear() + (now.getUTCMonth() >= 6 ? 1 : 0)
  if (!Array.isArray(record.seasons) || !record.seasons.includes(season)) return unknown
  const lastSuccess = typeof record.last_success_at === 'string' ? record.last_success_at : null
  if (record.status === 'unavailable') return { status: 'unavailable', last_success_at: lastSuccess }
  if (!lastSuccess || record.warehouse_updated !== true || typeof record.event_count !== 'number'
      || !Number.isInteger(record.event_count) || record.event_count < 0) return unknown
  const age = now.getTime() - Date.parse(lastSuccess)
  if (!Number.isFinite(age) || age < 0) return unknown
  return { status: age > 36 * 60 * 60 * 1000 ? 'stale' : 'fresh', last_success_at: lastSuccess }
}

export function getIngestionHealth() {
  try {
    const file = path.join(process.cwd(), 'backend/data/diagnostics/ingestion_status.json')
    return ingestionHealth(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return ingestionHealth(null)
  }
}
