export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_TURNS = 20;

interface HistoryMessage {
  id: bigint;
  role: string;
  status: string;
  content: string;
  createdAt: { microsSinceUnixEpoch: bigint };
  sequence?: number;
}

/** Only completed messages preceding this assistant reply belong in its prompt. */
export function buildHistory(rows: Iterable<HistoryMessage>, target: HistoryMessage): Turn[] {
  const precedesTarget = (row: HistoryMessage) => target.sequence !== undefined
    ? row.sequence !== undefined && row.sequence < target.sequence
    : row.createdAt.microsSinceUnixEpoch <= target.createdAt.microsSinceUnixEpoch;
  const turns: Turn[] = [...rows]
    .filter((r) => r.id !== target.id && precedesTarget(r) && r.status === 'done' && (r.role === 'user' || r.role === 'assistant'))
    .sort((a, b) => {
      if (a.sequence !== undefined && b.sequence !== undefined) return a.sequence - b.sequence;
      const delta = a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch;
      // A video question and its reply share a transaction timestamp. Existing
      // video rows lack a sequence, so order the user before its assistant.
      return delta < 0n ? -1 : delta > 0n ? 1 : a.role === b.role ? 0 : a.role === 'user' ? -1 : 1;
    })
    .map((r) => ({ role: r.role === 'user' ? 'user' : 'assistant', content: r.content }));
  const recent = turns.slice(-MAX_TURNS);
  while (recent.length > 0 && recent[0].role !== 'user') recent.shift();
  if (recent.length === 0 || recent[recent.length - 1].role !== 'user') {
    throw new Error(`chat_reply: the conversation before message ${target.id} does not end with a user question`);
  }
  return recent;
}
