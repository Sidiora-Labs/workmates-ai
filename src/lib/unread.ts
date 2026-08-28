export function unreadCount(bots: Array<{ unread?: boolean; archivedAt?: number | null }>): number {
  return bots.filter((bot) => bot.unread && !bot.archivedAt).length;
}
