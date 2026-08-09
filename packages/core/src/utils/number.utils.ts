/** Returns `true` if the value is a string representation of a number */
export function isStringNumber(value: string): boolean {
  if (value.trim() !== '') {
    return !Number.isNaN(+value);
  }
  return false;
}

/** Returns `true` if the value is a number or string representation of a number */
export function isNumberLike(value: unknown): value is number | string {
  if (typeof value === 'number') {
    return !Number.isNaN(value);
  } else if (typeof value === 'string') {
    return isStringNumber(value);
  }
  return false;
}

/** Returns `value` as a number if it is a number or string representation of a number, otherwise returns `NaN` */
export function parseNumber(value: unknown): number {
  return isNumberLike(value) ? Number(value) : NaN;
}
