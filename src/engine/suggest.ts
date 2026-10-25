export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j] as number;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(above + 1, (prev[j - 1] as number) + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return prev[b.length] as number;
}

/** Closest candidate within a small edit distance, compared case-insensitively. */
export function closest(input: string, candidates: Iterable<string>): string | undefined {
  const needle = input.toLowerCase();
  const limit = Math.max(2, Math.floor(input.length / 3));
  let best: { value: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = levenshtein(needle, candidate.toLowerCase());
    if (distance <= limit && (!best || distance < best.distance)) {
      best = { value: candidate, distance };
    }
  }
  return best?.value;
}

/** " Did you mean 'x'?" or an empty string. */
export function didYouMean(input: string, candidates: Iterable<string>, quote = "'"): string {
  const match = closest(input, candidates);
  return match ? ` Did you mean ${quote}${match}${quote}?` : '';
}
