import type { VisitStatus } from '../db/types'

export const STATUS_COLORS: Record<VisitStatus, string> = {
  favorite: '#e8a317',
  look_again: '#3d9bfd',
  end_of_con: '#9b7ed9',
  none: '#5a6578',
}

export const STATUS_LABELS: Record<VisitStatus, string> = {
  favorite: 'Favorite',
  look_again: 'Look again',
  end_of_con: 'End of con',
  none: 'None',
}

export const VISIT_STATUSES: VisitStatus[] = [
  'favorite',
  'look_again',
  'end_of_con',
  'none',
]
