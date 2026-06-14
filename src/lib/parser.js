import { parse } from 'csv-parse/sync';

const KNOWN_USERS = ['Aisha', 'Rohan', 'Priya', 'Meera', 'Sam', 'Dev', 'Kabir'];

const USER_ALIASES = {
  'aisha': 'Aisha',
  'rohan': 'Rohan',
  'rohan ': 'Rohan',
  'priya': 'Priya',
  'priya s': 'Priya',
  'meera': 'Meera',
  'sam': 'Sam',
  'dev': 'Dev',
  'kabir': 'Kabir',
  "dev's friend kabir": 'Kabir'
};

// Help parse dates: DD-MM-YYYY or Mar-14 or YYYY-MM-DD
export function parseCSVDate(dateStr) {
  if (!dateStr) return { parsedDate: null, isAmbiguous: false, isFormatInconsistent: true };

  const cleaned = dateStr.trim();
  
  // Format: Mar-14
  if (/^[a-zA-Z]{3}-\d{1,2}$/.test(cleaned)) {
    const parts = cleaned.split('-');
    const monthStr = parts[0].toLowerCase();
    const day = parseInt(parts[1], 10);
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const month = months[monthStr];
    if (month !== undefined) {
      // Based on context of 2026 expenses
      const date = new Date(2026, month, day);
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      return { parsedDate: `${yyyy}-${mm}-${dd}`, isAmbiguous: false, isFormatInconsistent: true };
    }
  }

  // Format: DD-MM-YYYY
  const dmYRegex = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
  if (dmYRegex.test(cleaned)) {
    const match = cleaned.match(dmYRegex);
    const d = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const y = parseInt(match[3], 10);

    // Check if the format is 04-05-2026 (Ambiguous date: could be April 5th or May 4th)
    const isAmbiguous = d <= 12 && m <= 12 && (d !== m); // e.g. 04-05-2026

    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return { parsedDate: `${y}-${mm}-${dd}`, isAmbiguous, isFormatInconsistent: false };
  }

  // Format: YYYY-MM-DD
  const yMdRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  if (yMdRegex.test(cleaned)) {
    return { parsedDate: cleaned, isAmbiguous: false, isFormatInconsistent: false };
  }

  // Fallback try Date.parse
  const timestamp = Date.parse(cleaned);
  if (!isNaN(timestamp)) {
    const d = new Date(timestamp);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return { parsedDate: `${yyyy}-${mm}-${dd}`, isAmbiguous: false, isFormatInconsistent: true };
  }

  return { parsedDate: null, isAmbiguous: false, isFormatInconsistent: true };
}

// Check membership dates:
// Meera: active 2026-02-01 to 2026-03-31
// Sam: active 2026-04-08 onwards
// Dev: active 2026-03-08 to 2026-03-14
// Kabir: active 2026-03-11 to 2026-03-11
// Aisha, Rohan, Priya: 2026-02-01 onwards
export function checkMembershipViolation(userName, dateStr) {
  if (!dateStr) return false;
  const normalized = USER_ALIASES[userName.trim().toLowerCase()];
  if (!normalized) return false;

  const date = new Date(dateStr);
  const meeraStart = new Date('2026-02-01');
  const meeraEnd = new Date('2026-03-31');
  const samStart = new Date('2026-04-08');
  const devStart = new Date('2026-03-08');
  const devEnd = new Date('2026-03-14');
  const kabirStart = new Date('2026-03-11');
  const kabirEnd = new Date('2026-03-11');

  if (normalized === 'Meera') {
    return date < meeraStart || date > meeraEnd;
  }
  if (normalized === 'Sam') {
    return date < samStart;
  }
  if (normalized === 'Dev') {
    return date < devStart || date > devEnd;
  }
  if (normalized === 'Kabir') {
    return date < kabirStart || date > kabirEnd;
  }

  return false;
}

// Clean description into a list of normalized words, filtering out filler words
export function cleanDescriptionWords(desc) {
  if (!desc) return [];
  return desc.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // remove punctuation
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 2 && w !== 'the' && w !== 'for' && w !== 'and' && w !== 'via');
}

export function detectDuplicates(rows) {
  const duplicates = [];

  for (let i = 0; i < rows.length; i++) {
    const rowA = rows[i];
    
    for (let j = i + 1; j < rows.length; j++) {
      const rowB = rows[j];
      
      const sameDate = rowA.date === rowB.date;
      if (!sameDate) continue; // Duplicates/conflicts must occur on the same day

      const wordsA = cleanDescriptionWords(rowA.description);
      const wordsB = cleanDescriptionWords(rowB.description);

      // Check overlap of words (intersection)
      const intersection = wordsA.filter(w => wordsB.includes(w));
      const hasSignificantOverlap = intersection.length >= 2 || 
        (wordsA.length > 0 && wordsB.length > 0 && 
         (wordsA.every(w => wordsB.includes(w)) || wordsB.every(w => wordsA.includes(w))));

      if (hasSignificantOverlap) {
        // Option 1: Complete duplicate (Same payer, same amount)
        if (rowA.paidByNormalized === rowB.paidByNormalized && Math.abs(rowA.amount - rowB.amount) < 0.01) {
          duplicates.push({
            type: 'EXACT_DUPLICATE',
            indexA: i,
            indexB: j,
            rowA,
            rowB,
            description: `Exact duplicate detected on ${rowA.date}: "${rowA.description}" and "${rowB.description}" (paid by ${rowA.paidByNormalized} = ₹${rowA.amount})`
          });
        } 
        // Option 2: Conflict (Same activity, different amount/payer)
        else {
          duplicates.push({
            type: 'CONFLICT_DUPLICATE',
            indexA: i,
            indexB: j,
            rowA,
            rowB,
            description: `Conflicting records for the same event on ${rowA.date}: "${rowA.description}" (paid by ${rowA.paidByNormalized} = ${rowA.amount} ${rowA.currency}) vs "${rowB.description}" (paid by ${rowB.paidByNormalized} = ${rowB.amount} ${rowB.currency})`
          });
        }
      }
    }
  }
  return duplicates;
}

export function parseCSVData(csvText) {
  // Parse CSV
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  const parsedRows = records.map((record, index) => {
    const rowNum = index + 2; // CSV is 1-indexed, header is row 1
    const anomalies = [];

    // 1. Paid By name parsing and normalization
    const rawPayer = record.paid_by || '';
    let paidByNormalized = null;
    let suggestedPayer = null;

    if (!rawPayer.trim()) {
      anomalies.push({
        type: 'PAYER_MISSING',
        message: 'Payer field is empty (who paid?).',
        severity: 'HIGH',
        field: 'paid_by'
      });
    } else {
      const cleanPayerName = rawPayer.trim().toLowerCase();
      paidByNormalized = USER_ALIASES[cleanPayerName] || null;
      if (!paidByNormalized) {
        anomalies.push({
          type: 'PAYER_UNKNOWN',
          message: `Unknown payer name: "${rawPayer}"`,
          severity: 'HIGH',
          field: 'paid_by'
        });
      } else if (rawPayer !== paidByNormalized) {
        anomalies.push({
          type: 'PAYER_NAME_INCONSISTENT',
          message: `Payer name normalized from "${rawPayer}" to "${paidByNormalized}"`,
          severity: 'LOW',
          field: 'paid_by',
          suggested: paidByNormalized
        });
      }
    }

    // 2. Amount format cleaning & validation
    let rawAmount = record.amount || '0';
    let amount = 0;
    let isAmountCleaned = false;
    let isAmountRounded = false;

    // Clean commas
    if (typeof rawAmount === 'string' && rawAmount.includes(',')) {
      rawAmount = rawAmount.replace(/,/g, '');
      isAmountCleaned = true;
    }

    amount = parseFloat(rawAmount);
    if (isNaN(amount)) {
      amount = 0;
      anomalies.push({
        type: 'AMOUNT_INVALID',
        message: `Amount "${record.amount}" is not a valid number.`,
        severity: 'HIGH',
        field: 'amount'
      });
    } else {
      if (isAmountCleaned) {
        anomalies.push({
          type: 'AMOUNT_FORMAT_CLEANED',
          message: `Amount format cleaned from "${record.amount}" to "${amount}"`,
          severity: 'LOW',
          field: 'amount',
          suggested: amount
        });
      }

      // Rounding check (INR/USD support 2 decimal places max)
      const decimalPart = String(amount).split('.')[1];
      if (decimalPart && decimalPart.length > 2) {
        const roundedAmount = Math.round(amount * 100) / 100;
        anomalies.push({
          type: 'AMOUNT_ROUNDED',
          message: `Amount rounded from ${amount} to ${roundedAmount} for currency precision.`,
          severity: 'LOW',
          field: 'amount',
          suggested: roundedAmount
        });
        amount = roundedAmount;
      }

      if (amount < 0) {
        anomalies.push({
          type: 'AMOUNT_NEGATIVE_REFUND',
          message: `Negative amount of ${amount} detected. This will be processed as a refund.`,
          severity: 'MEDIUM',
          field: 'amount'
        });
      }

      if (amount === 0) {
        anomalies.push({
          type: 'AMOUNT_ZERO',
          message: `Amount is zero. This expense has no balance effect.`,
          severity: 'MEDIUM',
          field: 'amount'
        });
      }
    }

    // 3. Currency validation
    let rawCurrency = record.currency || '';
    let currency = rawCurrency.trim().toUpperCase();
    if (!currency) {
      currency = 'INR';
      anomalies.push({
        type: 'CURRENCY_MISSING',
        message: 'Currency is missing. Defaulted to INR.',
        severity: 'MEDIUM',
        field: 'currency',
        suggested: 'INR'
      });
    } else if (currency === 'USD') {
      anomalies.push({
        type: 'CURRENCY_USD',
        message: 'Currency is USD. Requires exchange rate conversion to INR.',
        severity: 'MEDIUM',
        field: 'currency'
      });
    }

    // 4. Date formatting
    const { parsedDate, isAmbiguous, isFormatInconsistent } = parseCSVDate(record.date);
    if (!parsedDate) {
      anomalies.push({
        type: 'DATE_INVALID',
        message: `Date "${record.date}" could not be parsed.`,
        severity: 'HIGH',
        field: 'date'
      });
    } else {
      if (isFormatInconsistent) {
        anomalies.push({
          type: 'DATE_FORMAT_INCONSISTENT',
          message: `Date format inconsistent: converted "${record.date}" to "${parsedDate}"`,
          severity: 'LOW',
          field: 'date',
          suggested: parsedDate
        });
      }
      if (isAmbiguous) {
        anomalies.push({
          type: 'DATE_AMBIGUOUS',
          message: `Date "${record.date}" is ambiguous (could be DD-MM or MM-DD). Assumed DD-MM-YYYY (${parsedDate}).`,
          severity: 'MEDIUM',
          field: 'date',
          suggested: parsedDate
        });
      }
    }

    // 5. Split With membership and normalization
    const splitWithStr = record.split_with || '';
    const splitWithUsers = splitWithStr ? splitWithStr.split(';').map(n => n.trim()).filter(Boolean) : [];
    const splitWithNormalized = [];
    const missingMembers = [];

    for (const name of splitWithUsers) {
      const cleanName = name.toLowerCase();
      const normalized = USER_ALIASES[cleanName] || null;
      if (normalized) {
        splitWithNormalized.push(normalized);
        
        // 6. Check membership timeline bounds
        if (parsedDate && checkMembershipViolation(normalized, parsedDate)) {
          anomalies.push({
            type: 'MEMBERSHIP_OUT_OF_BOUNDS',
            message: `User "${normalized}" was not active on ${parsedDate} (membership bounds check).`,
            severity: 'HIGH',
            user: normalized,
            field: 'split_with'
          });
        }
      } else {
        // Kabir or unknown users
        splitWithNormalized.push(name); // keep raw name for now
        anomalies.push({
          type: 'EXTERNAL_MEMBER_INCLUDED',
          message: `User "${name}" is not a recognized group member.`,
          severity: 'MEDIUM',
          user: name,
          field: 'split_with'
        });
      }
    }

    if (splitWithNormalized.length === 0) {
      anomalies.push({
        type: 'SPLIT_WITH_MISSING',
        message: 'No split participants defined.',
        severity: 'HIGH',
        field: 'split_with'
      });
    }

    // 7. Split type & details consistency
    const rawSplitType = (record.split_type || '').trim().toLowerCase();
    let splitType = rawSplitType || null;
    const splitDetails = record.split_details || '';

    // Check if it is actually a settlement logged as an expense
    const isSettlementWord = record.description && (
      record.description.toLowerCase().includes('paid') || 
      record.description.toLowerCase().includes('settle') ||
      record.description.toLowerCase().includes('back') ||
      record.description.toLowerCase().includes('deposit')
    );
    if (!splitType && isSettlementWord) {
      anomalies.push({
        type: 'SETTLEMENT_LOGGED_AS_EXPENSE',
        message: 'This record appears to be a payment settlement, not a shared expense.',
        severity: 'MEDIUM',
        field: 'split_type',
        suggested: 'settlement'
      });
    }

    if (splitType === 'percentage') {
      // Parse details: Aisha 30%; Rohan 30%; Priya 30%; Meera 20%
      let sumPct = 0;
      const detailsList = splitDetails.split(';').map(d => d.trim()).filter(Boolean);
      detailsList.forEach(detail => {
        const match = detail.match(/([a-zA-Z\s']+)\s+(\d+(?:\.\d+)?)\s*%/);
        if (match) {
          sumPct += parseFloat(match[2]);
        }
      });

      if (Math.abs(sumPct - 100) > 0.01) {
        anomalies.push({
          type: 'PERCENTAGE_SUM_ERROR',
          message: `Percentages sum to ${sumPct}%, expected exactly 100%.`,
          severity: 'HIGH',
          field: 'split_details',
          currentSum: sumPct
        });
      }
    } else if (splitType === 'equal' && splitDetails.trim()) {
      anomalies.push({
        type: 'EQUAL_SPLIT_WITH_DETAILS_INCONSISTENCY',
        message: 'Equal split specifies custom details which are redundant.',
        severity: 'LOW',
        field: 'split_details'
      });
    }

    return {
      rowNum,
      dateRaw: record.date,
      date: parsedDate,
      description: record.description,
      paidByRaw: record.paid_by,
      paidByNormalized,
      amountRaw: record.amount,
      amount,
      currencyRaw: record.currency,
      currency,
      splitTypeRaw: record.split_type,
      splitType,
      splitWithRaw: record.split_with,
      splitWithNormalized,
      splitDetailsRaw: record.split_details,
      splitDetails,
      notes: record.notes,
      anomalies
    };
  });

  return parsedRows;
}
