/**
 * Generation log: in-memory (dev) or Redis (Vercel).
 * Uses KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV/Upstash integration)
 * or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Upstash Console).
 */
export type GenerationLogEntry = {
  lineNumber: number;
  requested_datetime: string;
  ip: string;
  generated_filename: string;
  threadIndex: number;
};

const LIST_KEY = "resume-tailor:logs";
const COUNTER_KEY = "resume-tailor:logs:next_line";
const MAX_ENTRIES = 5000;

function getRedisEnv(): { url: string; token: string } | null {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
  }
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
  }
  return null;
}

function useRedis(): boolean {
  return getRedisEnv() !== null;
}

// --- In-memory store (dev / when Redis not configured) ---
const globalForLog = globalThis as unknown as {
  __generationLogStore?: GenerationLogEntry[];
  __generationLogNextLine?: number;
};

const store: GenerationLogEntry[] = globalForLog.__generationLogStore ?? [];
if (!globalForLog.__generationLogStore) globalForLog.__generationLogStore = store;

let nextLineNumber = globalForLog.__generationLogNextLine ?? 1;
function advanceLineNumber(): number {
  const n = nextLineNumber++;
  globalForLog.__generationLogNextLine = nextLineNumber;
  return n;
}

// --- Redis store ---
async function getRedisClient() {
  const env = getRedisEnv();
  if (!env) throw new Error("Redis env not configured");
  const { Redis } = await import("@upstash/redis");
  return new Redis({ url: env.url, token: env.token });
}

async function appendLogRedis(
  entry: Omit<GenerationLogEntry, "lineNumber">
): Promise<void> {
  const redis = await getRedisClient();
  const lineNumber = await redis.incr(COUNTER_KEY);
  const full: GenerationLogEntry = { ...entry, lineNumber };
  await redis.lpush(LIST_KEY, JSON.stringify(full));
  await redis.ltrim(LIST_KEY, 0, MAX_ENTRIES - 1);
}

async function getLogsRedis(options: {
  page: number;
  limit: number;
  ip?: string;
  filename?: string;
}): Promise<{ logs: GenerationLogEntry[]; total: number }> {
  const redis = await getRedisClient();
  const raw = await redis.lrange<string>(LIST_KEY, 0, -1);
  const list: GenerationLogEntry[] = raw
    .map((s) => {
      try {
        return typeof s === "string" ? (JSON.parse(s) as GenerationLogEntry) : s;
      } catch {
        return null;
      }
    })
    .filter((e): e is GenerationLogEntry => e != null);

  let filtered = list;
  if (options.ip?.trim()) {
    const q = options.ip.trim().toLowerCase();
    filtered = filtered.filter((e) => e.ip.toLowerCase().includes(q));
  }
  if (options.filename?.trim()) {
    const q = options.filename.trim().toLowerCase();
    filtered = filtered.filter((e) =>
      e.generated_filename.toLowerCase().includes(q)
    );
  }

  const total = filtered.length;
  const start = (options.page - 1) * options.limit;
  const logs = filtered.slice(start, start + options.limit);
  return { logs, total };
}

// --- Public API (async so callers can await when using Redis) ---

export async function appendLog(
  entry: Omit<GenerationLogEntry, "lineNumber">
): Promise<void> {
  if (useRedis()) {
    await appendLogRedis(entry);
    return;
  }
  store.push({
    ...entry,
    lineNumber: advanceLineNumber(),
  });
}

function filterAndPaginate(
  list: GenerationLogEntry[],
  options: { page: number; limit: number; ip?: string; filename?: string }
): { logs: GenerationLogEntry[]; total: number } {
  let filtered = [...list].reverse();
  if (options.ip?.trim()) {
    const q = options.ip.trim().toLowerCase();
    filtered = filtered.filter((e) => e.ip.toLowerCase().includes(q));
  }
  if (options.filename?.trim()) {
    const q = options.filename.trim().toLowerCase();
    filtered = filtered.filter((e) =>
      e.generated_filename.toLowerCase().includes(q)
    );
  }
  const total = filtered.length;
  const start = (options.page - 1) * options.limit;
  const logs = filtered.slice(start, start + options.limit);
  return { logs, total };
}

export async function getLogs(options: {
  page: number;
  limit: number;
  ip?: string;
  filename?: string;
}): Promise<{ logs: GenerationLogEntry[]; total: number }> {
  if (useRedis()) {
    return getLogsRedis(options);
  }
  return filterAndPaginate(store, options);
}
