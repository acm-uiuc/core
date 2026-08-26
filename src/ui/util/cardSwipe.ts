const ICARD_SWIPE_PATTERN = /^%B6397%B6397(\d{9})\d{4}\^/;

export function parseICardSwipe(input: string): string | null {
  return input.match(ICARD_SWIPE_PATTERN)?.[1] ?? null;
}
