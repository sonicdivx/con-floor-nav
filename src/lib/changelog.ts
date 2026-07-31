/** App version + human-readable changelog (source for update toast & What's new page). */

export const APP_VERSION = '0.2.0'

export type ChangelogEntry = {
  version: string
  date: string
  /** Short bullets for the update toast */
  highlights: string[]
  /** Longer bullets for the changelog page */
  notes: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.2.0',
    date: '2026-07-31',
    highlights: [
      'Dealer search',
      'Cloud catalog sync',
      'Update notifications',
    ],
    notes: [
      'Dealer typeahead on Go and Map — tap a result to navigate',
      'Shared floor maps/dealers sync from the server when online',
      'Live party codes can persist overnight with Postgres',
      'Mobile viewport fixes (search/landscape shift, page zoom)',
      'In-app prompt when a new version is ready',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-07-30',
    highlights: ['First PWA release'],
    notes: [
      'Offline floor map, booths, vendor status, and photos',
      'Aisle pathfinding and Share pin / Live party',
      'Installable PWA with on-device IndexedDB storage',
    ],
  },
]

export function latestChangelog(): ChangelogEntry {
  return CHANGELOG[0]!
}

export function changelogForVersion(version: string): ChangelogEntry | undefined {
  return CHANGELOG.find((e) => e.version === version)
}
