/**
 * When a list was last read from the server, in words (E38/F05/S03): "Updated just now" for the
 * first minute, then whole minutes, then whole hours. A clock behind the read reads as just now.
 */
export function updatedAgo(readAt: number, now: number): string {
  const minutes = Math.floor(Math.max(now - readAt, 0) / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours} hour${hours === 1 ? '' : 's'} ago`;
}
