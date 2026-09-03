/**
 * The instant as ISO 8601 in the formatter's own zone — `2026-09-03T14:22:10-04:00` — assembled
 * from parts, because `Date` renders a zoned ISO string only for the process's own zone.
 */
export function renderIsoWithOffset(parts: readonly Intl.DateTimeFormatPart[]): string {
  const value = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new Error(`clock parts carry no ${type}`);
    }
    return part.value;
  };
  const offset = value('timeZoneName').replace('GMT', '');
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}${offset}`;
}
