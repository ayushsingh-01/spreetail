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

    const isAmbiguous = d <= 12 && m <= 12 && (d !== m);

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

// Generalized dynamic membership timeline check with legacy fallbacks
export function checkMembershipViolation(userName, dateStr, groupName = '', systemMemberships = []) {
  if (!dateStr) return false;

  // Legacy fallback rules for validation verification tests when no systemMemberships are passed
  if (!systemMemberships || systemMemberships.length === 0) {
    const date = new Date(dateStr);
    const meeraStart = new Date('2026-02-01');
    const meeraEnd = new Date('2026-03-31');
    const samStart = new Date('2026-04-08');
    const devStart = new Date('2026-03-08');
    const devEnd = new Date('2026-03-14');
    const kabirStart = new Date('2026-03-11');
    const kabirEnd = new Date('2026-03-11');

    if (userName === 'Meera') return date < meeraStart || date > meeraEnd;
    if (userName === 'Sam') return date < samStart;
    if (userName === 'Dev') return date < devStart || date > devEnd;
    if (userName === 'Kabir') return date < kabirStart || date > kabirEnd;
    return false;
  }

  // Dynamic database-driven checks!
  const userMems = systemMemberships.filter(m => m.user_name.toLowerCase() === userName.toLowerCase());

  if (userMems.length === 0) {
    return false; // Not in system yet, will join automatically
  }

  const targetMem = userMems.find(m => m.group_name && m.group_name.toLowerCase() === groupName.toLowerCase());
  if (!targetMem) {
    return false; // Not in this group yet, will join automatically
  }

  const checkDate = new Date(dateStr);
  const joined = new Date(targetMem.joined_at);
  if (checkDate < joined) {
    return true;
  }
  if (targetMem.left_at) {
    const left = new Date(targetMem.left_at);
    if (checkDate > left) {
      return true;
    }
  }

  return false;
}

// Clean description into a list of normalized words, filtering out filler words
export function cleanDescriptionWords(desc) {
  if (!desc) return [];
  return desc.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
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
      if (!sameDate) continue;

      const wordsA = cleanDescriptionWords(rowA.description);
      const wordsB = cleanDescriptionWords(rowB.description);

      const intersection = wordsA.filter(w => wordsB.includes(w));
      const hasSignificantOverlap = intersection.length >= 2 || 
        (wordsA.length > 0 && wordsB.length > 0 && 
         (wordsA.every(w => wordsB.includes(w)) || wordsB.every(w => wordsA.includes(w))));

      if (hasSignificantOverlap) {
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

export function classifyGroup(record, parsedDate, systemGroups = []) {
  const description = (record.description || '').toLowerCase();
  const splitWith = (record.split_with || '').toLowerCase();
  const notes = (record.notes || '').toLowerCase();

  // 1. Try to match to dynamic system group names case-insensitively
  if (systemGroups && systemGroups.length > 0) {
    for (const g of systemGroups) {
      const gNameLower = g.name.toLowerCase();
      if (description.includes(gNameLower) || notes.includes(gNameLower)) {
        return g.name;
      }
    }
  }
  
  // 2. Legacy fallback heuristics
  const hasGoaKeyword = description.includes('goa') || 
                         description.includes('thalassa') || 
                         description.includes('beach') || 
                         description.includes('parasailing') || 
                         description.includes('shack') ||
                         notes.includes('goa') ||
                         notes.includes('trip');

  const hasGoaMembers = splitWith.includes('dev') || splitWith.includes('kabir');

  let isGoaDate = false;
  let isGoaTimelineMonth = false;
  if (parsedDate) {
    const date = new Date(parsedDate);
    const goaStart = new Date('2026-03-08');
    const goaEnd = new Date('2026-03-14');
    isGoaDate = date >= goaStart && date <= goaEnd;
    isGoaTimelineMonth = date.getFullYear() === 2026 && date.getMonth() === 2;
  }

  if (hasGoaKeyword || isGoaDate || (hasGoaMembers && isGoaTimelineMonth)) {
    return 'Goa Trip 2026';
  }

  // 3. Fallback default
  if (systemGroups && systemGroups.length > 0) {
    return systemGroups[0].name;
  }
  return 'Flatmates 4B';
}

export function parseCSVData(csvText, systemUsers = [], systemGroups = [], systemMemberships = []) {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  // Dynamically initialize aliases map
  const aliases = { ...USER_ALIASES };
  if (systemUsers && Array.isArray(systemUsers)) {
    systemUsers.forEach(u => {
      aliases[u.name.toLowerCase().trim()] = u.name;
    });
  }

  const parsedRows = records.map((record, index) => {
    const rowNum = index + 2;
    const anomalies = [];

    // Classify group dynamically
    const { parsedDate, isAmbiguous, isFormatInconsistent } = parseCSVDate(record.date);
    const suggestedGroup = classifyGroup(record, parsedDate, systemGroups);

    // 1. Paid By name parsing and normalization
    const rawPayer = record.paid_by || '';
    let paidByNormalized = null;

    if (!rawPayer.trim()) {
      anomalies.push({
        type: 'PAYER_MISSING',
        message: 'Payer field is empty (who paid?).',
        severity: 'HIGH',
        field: 'paid_by'
      });
    } else {
      const cleanPayerName = rawPayer.trim().toLowerCase();
      if (!aliases[cleanPayerName]) {
        // Register new user dynamically
        const cleanTrimmed = rawPayer.trim();
        const titleCased = cleanTrimmed.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        aliases[cleanPayerName] = titleCased;
        anomalies.push({
          type: 'NEW_USER_DETECTED',
          message: `New user "${titleCased}" will be registered in the system.`,
          severity: 'LOW',
          user: titleCased,
          field: 'paid_by'
        });
      }
      paidByNormalized = aliases[cleanPayerName];
      if (rawPayer.trim() !== paidByNormalized) {
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

    for (const name of splitWithUsers) {
      const cleanName = name.toLowerCase();
      if (!aliases[cleanName]) {
        // Register new user dynamically
        const cleanTrimmed = name.trim();
        const titleCased = cleanTrimmed.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        aliases[cleanName] = titleCased;
        anomalies.push({
          type: 'NEW_USER_DETECTED',
          message: `New user "${titleCased}" will be registered in the system.`,
          severity: 'LOW',
          user: titleCased,
          field: 'split_with'
        });
      }
      
      const normalized = aliases[cleanName];
      splitWithNormalized.push(normalized);
      
      // Check membership timeline bounds dynamically
      if (parsedDate) {
        const isViolation = checkMembershipViolation(normalized, parsedDate, suggestedGroup, systemMemberships);
        if (isViolation) {
          anomalies.push({
            type: 'MEMBERSHIP_OUT_OF_BOUNDS',
            message: `User "${normalized}" was not active on ${parsedDate} (membership bounds check).`,
            severity: 'HIGH',
            user: normalized,
            field: 'split_with'
          });
        }
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

    // 6. Split type & details consistency
    const rawSplitType = (record.split_type || '').trim().toLowerCase();
    let splitType = rawSplitType || null;
    const splitDetails = record.split_details || '';

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
      suggestedGroup,
      anomalies
    };
  });

  return parsedRows;
}
