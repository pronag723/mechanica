/** Ids and stable ordering. */

/** Locale-independent id order (UTF-16 code units). Every stable iteration order uses it. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Id of the contact candidate between a body and face `face` of a static support. */
export function contactId(body: string, staticId: string, face: number): string {
  return `c:${body}:${staticId}:${face}`;
}
