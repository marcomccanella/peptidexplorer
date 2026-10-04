export type Fetcher = typeof fetch;
export type RequestOptions = {
  fetcher?: Fetcher;
  attempts?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export function retryAfterSeconds(response: Response, fallback = 5): number {
  const header = response.headers.get("retry-after");
  if (!header) return fallback;
  const numeric = Number(header);
  const seconds = Number.isFinite(numeric) ? numeric : (Date.parse(header) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.min(60, Math.max(1, Math.ceil(seconds))) : fallback;
}

export function transientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

// Every outbound request has a timeout. Only retry network failures and temporary HTTP failures.
export async function request(
  url: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const attempts = options.attempts ?? 3;
  const pause =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      });
    } catch {
      if (attempt + 1 === attempts) {
        throw new Error(
          "The data service could not be reached. Check the server's internet connection and retry.",
        );
      }
      await pause(1000 * 2 ** attempt);
      continue;
    }
    if (!transientStatus(response.status) || attempt + 1 === attempts) return response;
    // Release the current response before retrying so its connection can be reused.
    await response.body?.cancel();
    await pause(retryAfterSeconds(response, 2 ** attempt) * 1000);
  }
  throw new Error("The data service could not be reached.");
}

export async function jsonResponse<T>(response: Response, service: string): Promise<T> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${service} returned HTTP ${response.status}. Please retry later.`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`${service} returned an incomplete or unexpected response. Please retry.`);
  }
}

// Follow API pagination links only on that API's own host and path.
export function paginationUrl(next: string, current: string, prefix: string): string {
  const parsed = new URL(next, current);
  const allowed = new URL(prefix);
  if (parsed.origin !== allowed.origin || !parsed.pathname.startsWith(allowed.pathname)) {
    throw new Error("The data service returned an unexpected pagination link.");
  }
  return parsed.toString();
}

export async function mapConcurrent<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
