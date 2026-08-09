export function removeTrailingSlash(s: string) {
  return s.replace(/\/$/, '');
}

export function uncapitalize<T extends string>(s: T): Uncapitalize<T> {
  return (s.charAt(0).toLowerCase() + s.slice(1)) as Uncapitalize<T>;
}
