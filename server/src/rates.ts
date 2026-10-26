import db from './db';

const FALLBACK_RATES: Record<string, number> = {
  USD: 1.0,
  SGD: 1.35,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.2,
  AED: 3.67,
  CNY: 7.24,
};

export async function getDailyExchangeRates(): Promise<{
  base: string;
  date: string;
  rates: Record<string, number>;
  source: string;
  status: 'success' | 'failed';
}> {
  const today = new Date().toISOString().split('T')[0];

  // 1. Check if snapshot exists for today
  const existing = (await db.prepare('SELECT * FROM currency_rates WHERE rate_date = ? ORDER BY fetch_timestamp DESC LIMIT 1').get(today)) as {
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
      return {
        base: existing.base_currency,
        date: existing.rate_date,
        rates: { USD: 1.0, ...FALLBACK_RATES, ...parsedRates },
        source: existing.source,
        status: 'success',
      };
    } catch {
      // parse failed, try re-fetching
    }
  }

  // 2. Fetch from Frankfurter API
  const now = new Date().toISOString();
  try {
    // Only public currency codes are transmitted - no PII or claim data
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=SGD,EUR,GBP,INR,AED,CNY');
    if (!res.ok) {
      throw new Error(`Frankfurter HTTP error: ${res.status}`);
    }
    const data = await res.json() as {
      amount: number;
      base: string;
      date: string;
      rates: Record<string, number>;
    };

    const finalRates: Record<string, number> = {
      USD: 1.0,
      ...FALLBACK_RATES,
      ...(data.rates || {}),
    };

    // Store in currency_rates table
    const id = `rate-${today}-${Date.now()}`;
    await db.prepare(`
      INSERT INTO currency_rates (id, base_currency, rate_date, rates, source, fetch_timestamp, status)
      VALUES (?, 'USD', ?, ?, 'Frankfurter', ?, 'success')
    `).run(id, today, JSON.stringify(finalRates), now);

    return {
      base: 'USD',
      date: data.date || today,
      rates: finalRates,
      source: 'Frankfurter',
      status: 'success',
    };
  } catch (err: any) {
    console.error('Frankfurter API fetch failed, using fallback rates:', err?.message || err);

    // Save fallback snapshot
    const id = `rate-fallback-${today}-${Date.now()}`;
    await db.prepare(`
      INSERT INTO currency_rates (id, base_currency, rate_date, rates, source, fetch_timestamp, status, error_message)
      VALUES (?, 'USD', ?, ?, 'Fallback', ?, 'failed', ?)
    `).run(id, today, JSON.stringify(FALLBACK_RATES), now, String(err?.message || err));

    return {
      base: 'USD',
      date: today,
      rates: FALLBACK_RATES,
      source: 'Fallback',
      status: 'failed',
    };
  }
}
