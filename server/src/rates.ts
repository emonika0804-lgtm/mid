import db from './db';

export const FALLBACK_RATES: Record<string, number> = {
  USD: 1.0,
  SGD: 1.35,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.2,
  AED: 3.67,
  CNY: 7.24,
};

export interface ExchangeRatesResult {
  base: string;
  date: string;
  rates: Record<string, number>;
  source: string;
  status: 'success' | 'failed';
}

interface MemoryCache {
  data: ExchangeRatesResult;
  expiresAt: number;
}

// In-memory cache configurations
const SUCCESS_TTL_MS = 60 * 60 * 1000; // 1 hour for successful rates
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes failure cooldown to prevent API hammering
const FETCH_TIMEOUT_MS = 4000; // 4 seconds fetch timeout

let memoryCache: MemoryCache | null = null;
let inFlightPromise: Promise<ExchangeRatesResult> | null = null;
let lastErrorLogTimestamp = 0;

/**
 * Fetch with AbortController timeout
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch live rates from Frankfurter API with 1 controlled retry
 */
async function fetchFrankfurterRates(): Promise<{ date: string; rates: Record<string, number> }> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchWithTimeout(
        'https://api.frankfurter.app/latest?from=USD&to=SGD,EUR,GBP,INR,AED,CNY',
        FETCH_TIMEOUT_MS
      );
      if (!res.ok) {
        throw new Error(`Frankfurter HTTP error: ${res.status}`);
      }
      const data = (await res.json()) as {
        amount: number;
        base: string;
        date: string;
        rates: Record<string, number>;
      };
      if (!data || typeof data.rates !== 'object') {
        throw new Error('Frankfurter response missing rates object');
      }
      return {
        date: data.date || new Date().toISOString().split('T')[0],
        rates: data.rates,
      };
    } catch (err: any) {
      lastError = err;
      if (attempt < 2) {
        // 500ms backoff before retry
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  throw lastError;
}

/**
 * Core internal rate retrieval logic: checks DB, fetches external API, performs UPSERT, or applies fallback.
 */
async function executeGetDailyExchangeRates(): Promise<ExchangeRatesResult> {
  const today = new Date().toISOString().split('T')[0];

  // 1. Check if a successful snapshot exists in PostgreSQL for today
  try {
    const existing = (await db.prepare(
      'SELECT * FROM currency_rates WHERE rate_date = ? AND status = ? ORDER BY fetch_timestamp DESC LIMIT 1'
    ).get(today, 'success')) as {
      id: string;
      base_currency: string;
      rate_date: string;
      rates: string;
      source: string;
      fetch_timestamp: string;
      status: 'success' | 'failed';
      error_message?: string;
    } | undefined;

    if (existing && existing.status === 'success') {
      try {
        const parsedRates = JSON.parse(existing.rates);
        const result: ExchangeRatesResult = {
          base: existing.base_currency || 'USD',
          date: existing.rate_date,
          rates: { USD: 1.0, ...FALLBACK_RATES, ...parsedRates },
          source: existing.source || 'Frankfurter',
          status: 'success',
        };
        memoryCache = {
          data: result,
          expiresAt: Date.now() + SUCCESS_TTL_MS,
        };
        return result;
      } catch {
        // JSON parse error, proceed to fetch
      }
    }
  } catch (dbErr: any) {
    console.error('[Rates] Error checking existing rates in DB:', dbErr?.message || dbErr);
  }

  // 2. Check if a recent failure snapshot occurred within the cooldown window (e.g., after server restart)
  try {
    const recentFailed = (await db.prepare(
      'SELECT * FROM currency_rates WHERE rate_date = ? AND status = ? ORDER BY fetch_timestamp DESC LIMIT 1'
    ).get(today, 'failed')) as {
      fetch_timestamp: string;
    } | undefined;

    if (recentFailed && recentFailed.fetch_timestamp) {
      const failedTime = new Date(recentFailed.fetch_timestamp).getTime();
      const elapsed = Date.now() - failedTime;
      if (elapsed < FAILURE_COOLDOWN_MS) {
        const fallbackResult: ExchangeRatesResult = {
          base: 'USD',
          date: today,
          rates: FALLBACK_RATES,
          source: 'Fallback',
          status: 'failed',
        };
        memoryCache = {
          data: fallbackResult,
          expiresAt: Date.now() + (FAILURE_COOLDOWN_MS - elapsed),
        };
        return fallbackResult;
      }
    }
  } catch {
    // Non-critical, proceed
  }

  // 3. Attempt external fetch from Frankfurter API
  const nowIso = new Date().toISOString();
  try {
    const apiResult = await fetchFrankfurterRates();
    const finalRates: Record<string, number> = {
      USD: 1.0,
      ...FALLBACK_RATES,
      ...(apiResult.rates || {}),
    };

    // Deterministic ID with PostgreSQL UPSERT (INSERT ... ON CONFLICT DO UPDATE)
    const id = `rate-${today}`;
    await db.prepare(`
      INSERT INTO currency_rates (id, base_currency, rate_date, rates, source, fetch_timestamp, status, error_message)
      VALUES (?, 'USD', ?, ?, 'Frankfurter', ?, 'success', NULL)
      ON CONFLICT (id) DO UPDATE SET
        rates = EXCLUDED.rates,
        source = EXCLUDED.source,
        fetch_timestamp = EXCLUDED.fetch_timestamp,
        status = EXCLUDED.status,
        error_message = NULL
    `).run(id, today, JSON.stringify(finalRates), nowIso);

    const result: ExchangeRatesResult = {
      base: 'USD',
      date: apiResult.date || today,
      rates: finalRates,
      source: 'Frankfurter',
      status: 'success',
    };

    memoryCache = {
      data: result,
      expiresAt: Date.now() + SUCCESS_TTL_MS,
    };

    return result;
  } catch (err: any) {
    const nowMs = Date.now();
    // Throttled logging: log at most once per cooldown period
    if (nowMs - lastErrorLogTimestamp > FAILURE_COOLDOWN_MS) {
      console.warn('[Rates] Frankfurter API fetch failed, using fallback rates:', err?.message || err);
      lastErrorLogTimestamp = nowMs;
    }

    const id = `rate-${today}`;
    const errMsg = String(err?.message || err);

    // Save fallback snapshot safely using UPSERT
    // Do not overwrite existing 'success' status if today already had successful rates
    try {
      await db.prepare(`
        INSERT INTO currency_rates (id, base_currency, rate_date, rates, source, fetch_timestamp, status, error_message)
        VALUES (?, 'USD', ?, ?, 'Fallback', ?, 'failed', ?)
        ON CONFLICT (id) DO UPDATE SET
          rates = CASE WHEN currency_rates.status = 'success' THEN currency_rates.rates ELSE EXCLUDED.rates END,
          source = CASE WHEN currency_rates.status = 'success' THEN currency_rates.source ELSE EXCLUDED.source END,
          status = CASE WHEN currency_rates.status = 'success' THEN currency_rates.status ELSE EXCLUDED.status END,
          fetch_timestamp = EXCLUDED.fetch_timestamp,
          error_message = CASE WHEN currency_rates.status = 'success' THEN currency_rates.error_message ELSE EXCLUDED.error_message END
      `).run(id, today, JSON.stringify(FALLBACK_RATES), nowIso, errMsg);
    } catch (saveErr: any) {
      console.error('[Rates] Failed to save fallback rate record:', saveErr?.message || saveErr);
    }

    const fallbackResult: ExchangeRatesResult = {
      base: 'USD',
      date: today,
      rates: FALLBACK_RATES,
      source: 'Fallback',
      status: 'failed',
    };

    memoryCache = {
      data: fallbackResult,
      expiresAt: Date.now() + FAILURE_COOLDOWN_MS,
    };

    return fallbackResult;
  }
}

/**
 * Public function to get daily exchange rates with in-memory caching and in-flight promise deduplication.
 */
export async function getDailyExchangeRates(): Promise<ExchangeRatesResult> {
  const now = Date.now();
  if (memoryCache && memoryCache.expiresAt > now) {
    return memoryCache.data;
  }

  // Coalesce concurrent requests into a single active promise
  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = executeGetDailyExchangeRates().finally(() => {
    inFlightPromise = null;
  });

  return inFlightPromise;
}

/**
 * Helper to invalidate the in-memory cache (useful for testing or manual refresh)
 */
export function clearRatesMemoryCache(): void {
  memoryCache = null;
  inFlightPromise = null;
  lastErrorLogTimestamp = 0;
}
