/** Provider IDs are opaque strings. Equal numbers from different providers are different people. */
export type AthleteProvider = 'espn' | 'nba'
export interface AthleteIdentity {
  provider: AthleteProvider
  id: string
}

export function providerId(value: unknown): string | null {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  const id = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  return /^[1-9]\d{0,15}$/.test(id) ? id : null
}

export function sameAthlete(a: AthleteIdentity, b: AthleteIdentity): boolean {
  return a.provider === b.provider && a.id === b.id
}

export function playerGameHref(identity: AthleteIdentity, gameId: string, teamId: string): string | null {
  if (identity.provider !== 'espn' || !providerId(identity.id) || !providerId(gameId) || !providerId(teamId)) return null
  return `/players/espn/${identity.id}?game=${gameId}&team=${teamId}`
}

/** Availability on a provider's CDN is not a permission record. */
export interface AthleteImageAsset {
  provider: AthleteProvider
  subject: AthleteIdentity
  src: string
  provenance: { sourceUrl: string; verifiedAt: string }
  permission: {
    status: 'permitted' | 'unverified' | 'denied'
    basis: string | null
    reference: string | null
    verifiedAt: string | null
  }
}

// No athlete portraits in the repository have a verified permission record.
// Add assets only after recording subject, provenance and permission evidence.
const VERIFIED_ATHLETE_IMAGES: readonly AthleteImageAsset[] = []

export function permittedAthleteImage(
  identity: AthleteIdentity,
  assets: readonly AthleteImageAsset[] = VERIFIED_ATHLETE_IMAGES,
): AthleteImageAsset | null {
  return assets.find(asset =>
    sameAthlete(asset.subject, identity) && asset.provider === identity.provider &&
    providerId(identity.id) && /^\/athletes\/[a-zA-Z0-9/_-]+\.(png|jpe?g|webp)$/.test(asset.src) &&
    /^https:\/\//.test(asset.provenance.sourceUrl) &&
    Number.isFinite(Date.parse(asset.provenance.verifiedAt)) &&
    asset.permission.status === 'permitted' && !!asset.permission.basis?.trim() &&
    !!asset.permission.reference?.trim() &&
    !!asset.permission.verifiedAt && Number.isFinite(Date.parse(asset.permission.verifiedAt)),
  ) ?? null
}
