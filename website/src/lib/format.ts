/** "Jan 5, 2026" in a stable, locale-independent form. */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Join one or more authors into a readable byline. */
export function formatAuthors(author: string | string[]): string {
  return Array.isArray(author) ? author.join(', ') : author;
}
