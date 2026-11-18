import { getDailyExchangeRates } from './rates';

export const SUPPORTED_CURRENCIES = [
  'USD',
  'SGD',
  'EUR',
  'GBP',
  'INR',
  'AED',
  'CNY',
] as const;

export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];

// PostgreSQL NUMERIC(15, 4) supports up to 11 digits before the decimal point
export const MAX_MONETARY_VALUE = 99999999999.9999;

export interface MonetaryValidationResult {
  valid: boolean;
  value?: number;
  error?: string;
  code?: string;
}

/**
 * Validates monetary inputs against business rules and PostgreSQL NUMERIC(15,4) limits:
 * - Rejects NaN, Infinity, non-numeric values, booleans, objects, and malformed strings.
 * - Rejects negative values (unless explicitly allowed, but claims/surveys require non-negative).
 * - Enforces NUMERIC(15,4) precision (max 99,999,999,999.9999).
 * - Returns structured error and code for 400 Bad Request responses.
 */
export function validateMonetaryAmount(
  rawVal: any,
  fieldName: string = 'Amount',
  allowNullOrEmpty: boolean = true
): MonetaryValidationResult {
  if (rawVal === undefined || rawVal === null || rawVal === '') {
    if (allowNullOrEmpty) {
      return { valid: true, value: undefined };
    }
    return {
      valid: false,
      error: `${fieldName} is required`,
      code: 'INVALID_MONETARY_VALUE',
    };
  }

  // Reject boolean, arrays, objects
  if (typeof rawVal === 'boolean' || (typeof rawVal === 'object' && rawVal !== null)) {
    return {
      valid: false,
      error: `${fieldName} must be a valid numeric value`,
      code: 'INVALID_MONETARY_VALUE',
    };
  }

  // If string, ensure trimmed string is valid numeric without malformed characters
  if (typeof rawVal === 'string') {
    const trimmed = rawVal.trim();
    if (!trimmed) {
      if (allowNullOrEmpty) return { valid: true, value: undefined };
      return { valid: false, error: `${fieldName} is required`, code: 'INVALID_MONETARY_VALUE' };
    }
    // Reject strings with letters, currency symbols, or multiple decimals (e.g., "$100", "100abc")
    if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
      return {
        valid: false,
        error: `${fieldName} contains invalid numeric characters`,
        code: 'INVALID_MONETARY_VALUE',
      };
    }
  }

  const num = Number(rawVal);
  if (isNaN(num) || !isFinite(num)) {
    return {
      valid: false,
      error: `${fieldName} must be a finite numeric value`,
      code: 'INVALID_MONETARY_VALUE',
    };
  }

  if (num < 0) {
    return {
      valid: false,
      error: `${fieldName} cannot be negative`,
      code: 'INVALID_MONETARY_VALUE',
    };
  }

  if (num > MAX_MONETARY_VALUE) {
    return {
      valid: false,
      error: `${fieldName} exceeds maximum allowable limit of 99,999,999,999.99`,
      code: 'NUMERIC_OVERFLOW',
    };
  }

  // Safe rounding to 4 decimal places matching PostgreSQL NUMERIC(15,4)
  const rounded = Math.round(num * 10000) / 10000;
  return { valid: true, value: rounded };
}

/**
 * Server-side financial calculation integrity:
 * Recalculates USD amounts and exchange rates using trusted stored exchange rates.
 * Validates currency whitelist and enforces non-negative monetary amounts.
 * Prevents mass-assignment of client-supplied `amount_usd` and `exchange_rate`.
 */
export async function recalculateAndSanitizeTallyRecords(
  records: any,
  isRecovery: boolean = false
): Promise<{ valid: boolean; records?: any[]; error?: string; code?: string }> {
  if (records === undefined || records === null) {
    return { valid: true, records: [] };
  }

  let parsed = records;
  if (typeof records === 'string') {
    try {
      parsed = JSON.parse(records);
    } catch {
      return {
        valid: false,
        error: `${isRecovery ? 'Recovery' : 'Expense'} tally records must be a valid JSON array`,
        code: 'INVALID_TALLY_FORMAT',
      };
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      valid: false,
      error: `${isRecovery ? 'Recovery' : 'Expense'} tally records must be an array`,
      code: 'INVALID_TALLY_FORMAT',
    };
  }

  // Obtain trusted exchange rates snapshot
  const ratesResult = await getDailyExchangeRates();
  const trustedRates = ratesResult.rates || {};

  const sanitized: any[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return {
        valid: false,
        error: `Tally item at index ${i} is invalid`,
        code: 'INVALID_TALLY_ITEM',
      };
    }

    // 1. Currency validation
    const rawCurrency = item.currency || 'USD';
    if (typeof rawCurrency !== 'string') {
      return {
        valid: false,
        error: `Currency at index ${i} must be a string`,
        code: 'INVALID_CURRENCY',
      };
    }
    const currency = rawCurrency.trim().toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(currency as any)) {
      return {
        valid: false,
        error: `Unsupported currency '${currency}' at index ${i}. Supported currencies: ${SUPPORTED_CURRENCIES.join(', ')}`,
        code: 'UNSUPPORTED_CURRENCY',
      };
    }

    // 2. Settlement accounting rule: prevent settlement payouts from being recorded in ancillary expense tallies
    if (!isRecovery && item.expense_type && /^(Settlement Payout|Settlement Amount)$/i.test(String(item.expense_type).trim())) {
      return {
        valid: false,
        error: 'Settlement payouts must be recorded exclusively in claim amount. Expense tallies are reserved for ancillary costs only.',
        code: 'SETTLEMENT_PAYOUT_NOT_ALLOWED_IN_TALLY',
      };
    }

    // 3. Amount validation
    const rawAmount = isRecovery && item.recovery_amount !== undefined ? item.recovery_amount : item.amount;
    const amountVal = validateMonetaryAmount(rawAmount, `Amount at index ${i}`, false);
    if (!amountVal.valid) {
      return { valid: false, error: amountVal.error, code: amountVal.code };
    }
    const amount = amountVal.value!;

    // 3. Trusted Server-Side Recalculation
    const rate = trustedRates[currency] || 1.0;
    if (rate <= 0) {
      return {
        valid: false,
        error: `Invalid exchange rate for currency ${currency}`,
        code: 'INVALID_EXCHANGE_RATE',
      };
    }

    const exchangeRate = Math.round(rate * 10000) / 10000;
    let amountUsd = amount;
    if (currency !== 'USD' && rate > 0) {
      amountUsd = Math.round((amount / rate) * 100) / 100;
    } else {
      amountUsd = Math.round(amount * 100) / 100;
    }

    // 4. Validate optional settlement/recovery amounts
    let settlementAmt: number | undefined = undefined;
    if (item.settlement_amount !== undefined && item.settlement_amount !== null && item.settlement_amount !== '') {
      const settVal = validateMonetaryAmount(item.settlement_amount, `Settlement amount at index ${i}`, true);
      if (!settVal.valid) return { valid: false, error: settVal.error, code: settVal.code };
      settlementAmt = settVal.value;
    }

    let recoveredAmt: number | undefined = undefined;
    if (item.recovered_amount !== undefined && item.recovered_amount !== null && item.recovered_amount !== '') {
      const recVal = validateMonetaryAmount(item.recovered_amount, `Recovered amount at index ${i}`, true);
      if (!recVal.valid) return { valid: false, error: recVal.error, code: recVal.code };
      recoveredAmt = recVal.value;
    }

    let outstandingRec: number | undefined = undefined;
    if (item.outstanding_recovery !== undefined && item.outstanding_recovery !== null && item.outstanding_recovery !== '') {
      const outVal = validateMonetaryAmount(item.outstanding_recovery, `Outstanding recovery at index ${i}`, true);
      if (!outVal.valid) return { valid: false, error: outVal.error, code: outVal.code };
      outstandingRec = outVal.value;
    }

    // Clean sanitized record preventing mass-assignment of calculated fields
    const sanitizedItem: any = {
      id: item.id || `rec-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      date: item.date || new Date().toISOString().split('T')[0],
      description: typeof item.description === 'string' ? item.description : '',
      currency,
      amount,
      exchange_rate: exchangeRate,   // AUTHORITATIVE SERVER RECALCULATED
      amount_usd: amountUsd,         // AUTHORITATIVE SERVER RECALCULATED
    };

    if (isRecovery) {
      if (item.recovery_type) sanitizedItem.recovery_type = item.recovery_type;
      if (item.recovery_source) sanitizedItem.recovery_source = item.recovery_source;
      if (item.liable_party) sanitizedItem.liable_party = item.liable_party;
      if (item.recovery_status) sanitizedItem.recovery_status = item.recovery_status;
      if (item.status) sanitizedItem.status = item.status;
      if (item.responsible_handler) sanitizedItem.responsible_handler = item.responsible_handler;
      if (item.remarks) sanitizedItem.remarks = item.remarks;
      sanitizedItem.recovery_amount = amount;
      if (recoveredAmt !== undefined) sanitizedItem.recovered_amount = recoveredAmt;
      if (outstandingRec !== undefined) sanitizedItem.outstanding_recovery = outstandingRec;
    } else {
      if (item.expense_type) sanitizedItem.expense_type = item.expense_type;
      if (item.status) sanitizedItem.status = item.status;
      if (settlementAmt !== undefined) sanitizedItem.settlement_amount = settlementAmt;
      if (item.settlement_date) sanitizedItem.settlement_date = item.settlement_date;
      if (item.responsible_user) sanitizedItem.responsible_user = item.responsible_user;
    }

    sanitized.push(sanitizedItem);
  }

  return { valid: true, records: sanitized };
}
