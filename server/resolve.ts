// Deterministic entity resolution: maps a user mention ("牛奶") to a task
// ("买牛奶") without ever asking the model to copy Chinese tokens exactly.

export interface TaskRef {
  id: string;
  title: string;
  done: boolean;
}

export type Resolution =
  | { status: "matched"; task: TaskRef }
  | { status: "ambiguous"; candidates: TaskRef[] }
  | { status: "none" };

const SIMILARITY_THRESHOLD = 0.7; // normalized Levenshtein

export function resolveTask(query: string, tasks: TaskRef[]): Resolution {
  const q = query.trim();
  if (!q) return { status: "none" };

  const byId = tasks.find((t) => t.id === q);
  if (byId) return { status: "matched", task: byId };

  const exact = tasks.filter((t) => t.title === q);
  if (exact.length === 1) return { status: "matched", task: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact };

  const contained = tasks.filter((t) => t.title.includes(q) || q.includes(t.title));
  if (contained.length === 1) return { status: "matched", task: contained[0] };
  if (contained.length > 1) return { status: "ambiguous", candidates: contained };

  const similar = tasks.filter((t) => similarity(q, t.title) >= SIMILARITY_THRESHOLD);
  if (similar.length === 1) return { status: "matched", task: similar[0] };
  if (similar.length > 1) return { status: "ambiguous", candidates: similar };

  return { status: "none" };
}

// Normalized Levenshtein similarity in [0, 1].
export function similarity(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;
  return 1 - levenshtein(a, b) / maxLength;
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}
