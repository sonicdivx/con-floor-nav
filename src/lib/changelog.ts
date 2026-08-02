/** App version + human-readable changelog (source for update toast & What's new page). */

export const APP_VERSION = '0.3.15'

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
    version: '0.3.15',
    date: '2026-08-02',
    highlights: [
      'Drag-and-drop tour stop reorder',
      'Map-placed tour end pin',
    ],
    notes: [
      'Drag the handle to reorder planned stops; full-height trash removes a stop',
      'Set end pin on the map (green End pin) — tour path finishes there after the last booth',
      'Touch-friendly pointer drag works on phones',
    ],
  },
  {
    version: '0.3.14',
    date: '2026-08-02',
    highlights: [
      'Tour end point (My pin or booth)',
      'Reorder and remove tour stops',
    ],
    notes: [
      'Plan route can finish at My pin or a chosen booth (green E marker)',
      'After planning, reorder stops with ↑/↓ or remove with ×; path updates in place',
      'Manual order is kept until you Plan route again',
    ],
  },
  {
    version: '0.3.13',
    date: '2026-08-02',
    highlights: [
      'Multi-stop booth tour per map',
      'Plan route from Favorites / Look again / End of con',
    ],
    notes: [
      'Go → Plan route builds an aisle path from My pin through selected booths on the active map only',
      'Nearest-neighbor + 2-opt ordering; numbered stop markers on the map',
      'Add extra booths via search; Dealers and Artist Alley tours stay separate',
    ],
  },
  {
    version: '0.3.12',
    date: '2026-08-01',
    highlights: [
      'Every sheet column in Booth info',
      'Works if Google Sheets goes offline',
    ],
    notes: [
      'Booth info always lists Name, Socials, Merch, all fandom columns, and 18+ (blank cells as —)',
      'Full column set cached in catalog DB + on-device sync — no live Google dependency',
      'sampleRevision 10',
    ],
  },
  {
    version: '0.3.11',
    date: '2026-08-01',
    highlights: [
      'Full AA + Dealers sheet data offline',
      'Masterlists stored in catalog DB',
    ],
    notes: [
      'Entire unofficial AA and Dealers Hall sheets ship in the shared catalog (Postgres + device sync)',
      'Booth info shows sheet columns: socials, merch, fandoms, 18+, tablemates',
      'PWA caches sample/masterlist JSON for offline; sampleRevision 9',
    ],
  },
  {
    version: '0.3.10',
    date: '2026-08-01',
    highlights: [
      'Booth info visible under View details',
      'Merch teaser in details header',
    ],
    notes: [
      'Booth info moved to top of details; sheet expands when guide data exists',
      'Masterlist fields apply to all local events with matching booth numbers',
      'One-time forced catalog re-sync + sampleRevision 8',
    ],
  },
  {
    version: '0.3.9',
    date: '2026-08-01',
    highlights: [
      'Fix Booth info in View details',
      'Force catalog re-sync for masterlists',
    ],
    notes: [
      'Booth info opens by default above Item photos',
      'Catalog sync writes masterlist data onto booths + vendors and re-pulls if local info is missing',
      'Catalog sampleRevision 7',
    ],
  },
  {
    version: '0.3.8',
    date: '2026-08-01',
    highlights: [
      'Dealers Hall masterlist info',
      'Booth info for both halls',
    ],
    notes: [
      'Imported unofficial Otakon Dealers Hall masterlist (merch, fandoms, 18+, guests)',
      'Vendor details collapsible renamed to Booth info (Dealers + Artist Alley)',
      'Catalog sampleRevision 6',
    ],
  },
  {
    version: '0.3.7',
    date: '2026-08-01',
    highlights: [
      'Artist Alley masterlist info',
      'Collapsible artist details',
    ],
    notes: [
      'Imported unofficial Otakon AA masterlist (merch, fandoms, 18+, tablemates)',
      'Vendor details: Booth info section above photos (collapsed by default)',
      'Catalog sampleRevision 5 so sync pulls the new fields',
    ],
  },
  {
    version: '0.3.6',
    date: '2026-08-01',
    highlights: ['Library photo multi-select'],
    notes: [
      'Vendor details → Library lets you pick multiple photos at once',
      'Optional note applies to every photo in that batch',
    ],
  },
  {
    version: '0.3.5',
    date: '2026-08-01',
    highlights: [
      'Map tab is the floor-map dropdown',
      'Active map stays until you switch',
    ],
    notes: [
      'Map tab shows Dealers / Artist Alley when multiple maps are loaded',
      'Hamburger stays fixed at the end of the top bar',
      'Catalog sync / adding a hall no longer steals the active map',
    ],
  },
  {
    version: '0.3.4',
    date: '2026-08-01',
    highlights: [
      'Map dropdown in top bar + map menu',
      'Force catalog re-sync for Artist Alley',
    ],
    notes: [
      'Map dropdown on Map/Go tabs and in the map options menu',
      'Catalog sampleRevision bumped so clients pull Dealers + Artist Alley',
      'Sync also re-pulls when local map count is behind the catalog',
    ],
  },
  {
    version: '0.3.3',
    date: '2026-08-01',
    highlights: [
      'Map dropdown switcher',
      'Fix catalog re-sync for Artist Alley',
    ],
    notes: [
      'Top bar Map dropdown to switch Dealers ↔ Artist Alley',
      'Cloud sync re-pulls when sampleRevision changes so new maps appear',
    ],
  },
  {
    version: '0.3.2',
    date: '2026-08-01',
    highlights: [
      'Otakon Artist Alley map',
      '381 artist booths + names',
    ],
    notes: [
      'New Artist Alley floor map from Conference Harvester (EventKey PREDZGII)',
      'Dealers map unchanged — switch halls with the Map dropdown',
      'Cloud sync / Settings → Import → Add Artist Alley',
    ],
  },
  {
    version: '0.3.1',
    date: '2026-07-31',
    highlights: [
      'Gallery fullscreen photo viewer',
      'Pinch to zoom photos',
    ],
    notes: [
      'Photos tab: tap a photo to open fullscreen with vendor name',
      'Pinch / scroll wheel zoom, pan when zoomed, Close or Escape to exit',
      'Hold a thumbnail to multi-select for revisit passes',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-07-31',
    highlights: [
      'Device login (no password)',
      'Pull content on another browser',
    ],
    notes: [
      'Settings → Device login: create a unique code, save favorites/notes/photos/pin to the cloud',
      'On another browser (or after a hung tab), enter the code → Log in & pull',
      'Shared floor maps still come from catalog sync; the code is the only secret',
    ],
  },
  {
    version: '0.2.1',
    date: '2026-07-31',
    highlights: [
      'Hard refresh on Update to latest',
      'Search done checkmark',
      'Details camera / expand',
    ],
    notes: [
      'Update to latest clears SW caches and reloads with a __cfn_r bust token',
      'Dealer/tag search checkmark dismisses the keyboard/dropdown',
      'Vendor details header: camera shortcut and expand sheet control',
    ],
  },
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
