import { permittedAthleteImage, playerGameHref, providerId, sameAthlete, type AthleteImageAsset } from '@/lib/athleteIdentity'

const identity = { provider: 'espn', id: '123' } as const
const permitted: AthleteImageAsset = {
  provider: 'espn', subject: identity, src: '/athletes/test-approved.webp',
  provenance: { sourceUrl: 'https://www.espn.com/test-fixture', verifiedAt: '2026-10-06T00:00:00Z' },
  permission: { status: 'permitted', basis: 'Test permission record', reference: 'test-fixture', verifiedAt: '2026-10-06T00:00:00Z' },
}

test('numeric namespaces do not identify the same athlete', () => {
  expect(sameAthlete(identity, { provider: 'nba', id: '123' })).toBe(false)
  expect(playerGameHref({ provider: 'nba', id: '123' }, '456', '18')).toBeNull()
  expect(playerGameHref(identity, '456', '18')).toBe('/players/espn/123?game=456&team=18')
})

test.each(['', '0', '00123', '../123', '1e3', '-12', '123?name=Other', Number.MAX_SAFE_INTEGER + 1])('refuses malformed or lossy IDs: %s', value => {
  expect(providerId(value)).toBeNull()
})

test('no portraits are permitted by default', () => {
  expect(permittedAthleteImage(identity)).toBeNull()
})

test('requires matching provider, subject, provenance and permission evidence', () => {
  expect(permittedAthleteImage(identity, [permitted])).toBe(permitted)
  for (const asset of [
    { ...permitted, subject: { provider: 'nba', id: '123' } as const },
    { ...permitted, subject: { provider: 'espn', id: '124' } as const },
    { ...permitted, provider: 'nba' as const },
    { ...permitted, src: 'https://cdn.example.com/123.webp' },
    { ...permitted, src: '/athletes/../unverified.webp' },
    { ...permitted, provenance: { ...permitted.provenance, verifiedAt: '' } },
    { ...permitted, permission: { ...permitted.permission, status: 'unverified' as const } },
    { ...permitted, permission: { ...permitted.permission, reference: null } },
    { ...permitted, permission: { ...permitted.permission, basis: null } },
  ]) expect(permittedAthleteImage(identity, [asset])).toBeNull()
})
