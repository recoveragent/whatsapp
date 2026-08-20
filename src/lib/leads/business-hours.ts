/**
 * Call-window helpers. Cadence call hours are IST (Asia/Kolkata) with
 * no DST, so we can shift UTC by a fixed +05:30 without a tz database.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

export interface CallWindow {
  /** Minutes from midnight IST, inclusive. */
  startMinutes: number
  /** Minutes from midnight IST, exclusive. */
  endMinutes: number
  /** 0=Sun … 6=Sat */
  days: number[]
}

export const DEFAULT_CALL_WINDOW: CallWindow = {
  startMinutes: 10 * 60,
  endMinutes: 19 * 60,
  days: [1, 2, 3, 4, 5, 6],
}

export function parseHmToMinutes(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm.trim())
  if (!m) return 10 * 60
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 10 * 60
  return Math.min(24 * 60, Math.max(0, hours * 60 + minutes))
}

export function callWindowFromCadence(args: {
  call_hours_start?: string | null
  call_hours_end?: string | null
  call_days?: number[] | null
}): CallWindow {
  const days = (args.call_days ?? DEFAULT_CALL_WINDOW.days).filter(
    (d) => d >= 0 && d <= 6,
  )
  return {
    startMinutes: parseHmToMinutes(
      args.call_hours_start ?? '10:00',
    ),
    endMinutes: parseHmToMinutes(args.call_hours_end ?? '19:00'),
    days: days.length > 0 ? days : [...DEFAULT_CALL_WINDOW.days],
  }
}

interface IstParts {
  year: number
  month: number
  day: number
  weekday: number
  minutes: number
}

function istParts(date: Date): IstParts {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}

function fromIst(parts: {
  year: number
  month: number
  day: number
  minutes: number
}): Date {
  const hours = Math.floor(parts.minutes / 60)
  const mins = parts.minutes % 60
  const utcMs = Date.UTC(
    parts.year,
    parts.month,
    parts.day,
    hours,
    mins,
    0,
    0,
  )
  return new Date(utcMs - IST_OFFSET_MS)
}

function addIstDays(
  parts: IstParts,
  days: number,
): Pick<IstParts, 'year' | 'month' | 'day' | 'weekday'> {
  const utc = Date.UTC(parts.year, parts.month, parts.day + days)
  const d = new Date(utc)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
  }
}

function isWorkingDay(weekday: number, days: number[]): boolean {
  return days.includes(weekday)
}

/**
 * If `from` is inside the call window, return it. Otherwise return the
 * next window open (IST).
 */
export function nextCallSlot(
  from: Date,
  window: CallWindow = DEFAULT_CALL_WINDOW,
): Date {
  const start = Math.min(window.startMinutes, window.endMinutes - 1)
  const end = Math.max(window.endMinutes, start + 1)
  const days =
    window.days.length > 0 ? window.days : [...DEFAULT_CALL_WINDOW.days]

  const parts = istParts(from)
  if (
    isWorkingDay(parts.weekday, days) &&
    parts.minutes >= start &&
    parts.minutes < end
  ) {
    return from
  }

  let cursor: Pick<IstParts, 'year' | 'month' | 'day' | 'weekday'> = parts
  let openToday = isWorkingDay(parts.weekday, days) && parts.minutes < start
  if (!openToday) {
    for (let i = 1; i <= 8; i++) {
      cursor = addIstDays(parts, i)
      if (isWorkingDay(cursor.weekday, days)) break
    }
  }

  return fromIst({
    year: cursor.year,
    month: cursor.month,
    day: cursor.day,
    minutes: start,
  })
}

export function addMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60_000)
}
