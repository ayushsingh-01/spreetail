'use client';

import { useState, useEffect, useRef } from 'react';

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

export default function Home() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [systemUsers, setSystemUsers] = useState([]);
  
  // Balance state
  const [balances, setBalances] = useState({});
  const [payments, setPayments] = useState([]);
  const [auditUser, setAuditUser] = useState('');
  const [ledger, setLedger] = useState([]);

  // Import wizard state
  const [importStep, setImportStep] = useState('upload'); // upload, resolve, success
  const [parsedCSV, setParsedCSV] = useState(null);
  const [usdRate, setUsdRate] = useState(83.0);
  const [resolutions, setResolutions] = useState({}); // rowNum -> resolutions details
  const [selectedDuplicates, setSelectedDuplicates] = useState({}); // dupKey -> index to keep (indexA, indexB, both, none)
  const [importReport, setImportReport] = useState(null);
  const fileInputRef = useRef(null);

  // Manual Forms
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState([]);

  const [manualExpense, setManualExpense] = useState({
    description: '',
    amount: '',
    currency: 'INR',
    paid_by_user_id: '',
    split_type: 'equal',
    expense_date: new Date().toISOString().split('T')[0],
    notes: '',
    split_with: [],
    split_details: {} // user_id -> custom split value (amount, pct, share)
  });

  const [manualSettlement, setManualSettlement] = useState({
    payer_id: '',
    payee_id: '',
    amount: '',
    currency: 'INR',
    settlement_date: new Date().toISOString().split('T')[0],
    notes: ''
  });

  // Load Groups and Users
  const loadInitialData = async () => {
    try {
      const gRes = await fetch('/api/groups');
      const gData = await gRes.json();
      setGroups(gData);
      if (gData.length > 0 && !selectedGroupId) {
        setSelectedGroupId(gData[0].id);
      }

      const uRes = await fetch('/api/users');
      const uData = await uRes.json();
      setSystemUsers(uData);
      if (uData.length > 0 && !auditUser) {
        setAuditUser(uData[0].name);
      }
    } catch (e) {
      console.error('Failed to load initial data', e);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // Recalculate balances whenever selected group or audit user changes
  useEffect(() => {
    if (selectedGroupId) {
      fetchBalances();
    }
  }, [selectedGroupId, auditUser]);

  const fetchBalances = async () => {
    if (!selectedGroupId) return;
    try {
      const res = await fetch(`/api/balances?groupId=${selectedGroupId}&auditUser=${auditUser}`);
      const data = await res.json();
      if (!data.error) {
        setBalances(data.balances || {});
        setPayments(data.payments || []);
        setLedger(data.ledger || []);
      }
    } catch (e) {
      console.error('Failed to fetch balances', e);
    }
  };

  const currentGroup = groups.find(g => g.id === selectedGroupId);

  // File Upload Handlers
  const handleFileUpload = async (e) => {
    const file = e.target.files[0] || e.dataTransfer?.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setParsedCSV(data);
        
        // Initialize resolutions
        const initialResolutions = {};
        data.records.forEach(row => {
          const rowRes = {};
          
          row.anomalies.forEach(anom => {
            if (anom.type === 'DATE_AMBIGUOUS') {
              rowRes.dateDecision = '05-04-2026'; // Default to April 5th as per note
            }
            if (anom.type === 'PAYER_MISSING') {
              rowRes.payerDecision = ''; // User must select
            }
            if (anom.type === 'PERCENTAGE_SUM_ERROR') {
              rowRes.percentageDecision = 'normalize'; // Default normalize
            }
            if (anom.type === 'MEMBERSHIP_OUT_OF_BOUNDS') {
              rowRes.membershipDecision = 'remove'; // Default remove out-of-bounds user from split
            }
            if (anom.type === 'EXTERNAL_MEMBER_INCLUDED') {
              rowRes.externalDecision = 'add_kabir'; // Default to adding Kabir
            }
          });
          initialResolutions[row.rowNum] = rowRes;
        });

        // Initialize duplicates keep map (default keep row A which is first, delete row B)
        const initialDups = {};
        data.duplicates.forEach(dup => {
          const key = `${dup.indexA}_${dup.indexB}`;
          initialDups[key] = 'keepA'; // Keep first instance, delete duplicate
        });

        setResolutions(initialResolutions);
        setSelectedDuplicates(initialDups);
        setImportStep('resolve');
      } else {
        alert('Upload failed: ' + data.error);
      }
    } catch (err) {
      alert('Error parsing file: ' + err.message);
    }
  };

  // Drag & drop handlers
  const handleDragOver = (e) => { e.preventDefault(); };
  const handleDrop = (e) => {
    e.preventDefault();
    handleFileUpload(e);
  };

  // Resolve Anomaly Setters
  const updateResolution = (rowNum, key, value) => {
    setResolutions(prev => ({
      ...prev,
      [rowNum]: {
        ...prev[rowNum],
        [key]: value
      }
    }));
  };

  // Apply resolution and import into DB
  const executeImport = async () => {
    if (!selectedGroupId) {
      alert('Please select a group first!');
      return;
    }

    const { records, duplicates } = parsedCSV;
    const resolvedExpenses = [];
    const resolvedSettlements = [];

    // Helper map to find user ID by name
    const getUserObjByName = (name) => systemUsers.find(u => u.name === name);

    // Track rows to skip (deleted because of duplicate choice)
    const rowsToSkip = new Set();
    duplicates.forEach(dup => {
      const key = `${dup.indexA}_${dup.indexB}`;
      const choice = selectedDuplicates[key];
      if (choice === 'keepA') {
        rowsToSkip.add(dup.rowB.rowNum);
      } else if (choice === 'keepB') {
        rowsToSkip.add(dup.rowA.rowNum);
      } else if (choice === 'deleteBoth') {
        rowsToSkip.add(dup.rowA.rowNum);
        rowsToSkip.add(dup.rowB.rowNum);
      }
    });

    const anomalyReportLines = [];

    for (const row of records) {
      if (rowsToSkip.has(row.rowNum)) {
        anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Deleted as duplicate conflict.`);
        continue;
      }

      const rowRes = resolutions[row.rowNum] || {};

      // Date Resolution
      let finalDate = row.date;
      if (row.anomalies.some(a => a.type === 'DATE_AMBIGUOUS')) {
        const decision = rowRes.dateDecision; // '04-05-2026' (May 4) or '05-04-2026' (April 5)
        if (decision === '04-05-2026') {
          finalDate = '2026-05-04';
          anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Ambiguous date resolved to May 4th.`);
        } else {
          finalDate = '2026-04-05';
          anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Ambiguous date resolved to April 5th.`);
        }
      } else if (row.anomalies.some(a => a.type === 'DATE_FORMAT_INCONSISTENT')) {
        anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Date format cleaned from "${row.dateRaw}" to "${row.date}".`);
      }

      // Payer Resolution
      let payerName = row.paidByNormalized;
      if (row.anomalies.some(a => a.type === 'PAYER_MISSING')) {
        payerName = rowRes.payerDecision;
        if (!payerName) {
          alert(`Row ${row.rowNum} is missing a payer. Please resolve it.`);
          return;
        }
        anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Missing payer resolved to "${payerName}".`);
      } else if (row.anomalies.some(a => a.type === 'PAYER_NAME_INCONSISTENT')) {
        anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Payer name normalized from "${row.paidByRaw}" to "${payerName}".`);
      }

      const payerUser = getUserObjByName(payerName);
      if (!payerUser) {
        alert(`Row ${row.rowNum}: Invalid payer selected.`);
        return;
      }

      // Currency and Converted Amount
      let currency = row.currency;
      let amount = row.amount;
      let convertedAmount = amount;

      if (currency === 'USD') {
        convertedAmount = Math.round(amount * usdRate * 100) / 100;
        anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): USD ${amount} converted to INR ${convertedAmount} using exchange rate ${usdRate}.`);
      } else {
        if (row.anomalies.some(a => a.type === 'CURRENCY_MISSING')) {
          anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Missing currency defaulted to INR.`);
        }
        if (row.anomalies.some(a => a.type === 'AMOUNT_FORMAT_CLEANED')) {
          anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Cleaned currency formatting comma.`);
        }
        if (row.anomalies.some(a => a.type === 'AMOUNT_ROUNDED')) {
          anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Rounded decimal amount for precision.`);
        }
      }

      // Check for zero amount
      if (row.anomalies.some(a => a.type === 'AMOUNT_ZERO')) {
        anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Recorded $0 value Swiggy dinner.`);
      }

      // Check if it is a settlement
      const isSettlement = row.splitType === 'settlement' || 
                           row.anomalies.some(a => a.type === 'SETTLEMENT_LOGGED_AS_EXPENSE');
      
      if (isSettlement) {
        // Find payee
        const payeeName = row.splitWithNormalized[0];
        const payeeUser = getUserObjByName(payeeName);
        if (!payeeUser) {
          alert(`Row ${row.rowNum} (Settlement): Payee "${payeeName}" not found.`);
          return;
        }

        resolvedSettlements.push({
          payer_id: payerUser.id,
          payee_id: payeeUser.id,
          amount,
          currency,
          converted_amount_inr: convertedAmount,
          settlement_date: finalDate,
          notes: row.notes || 'Imported peer-to-peer settlement'
        });
        anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Logged directly as a Settlement of INR ${convertedAmount} from ${payerName} to ${payeeName}.`);
        continue;
      }

      // Split participants resolution (out-of-bounds membership or external members)
      let finalSplitWith = [...row.splitWithNormalized];

      // Handle out of bounds membership (Meera in April)
      if (row.anomalies.some(a => a.type === 'MEMBERSHIP_OUT_OF_BOUNDS')) {
        const oobAnoms = row.anomalies.filter(a => a.type === 'MEMBERSHIP_OUT_OF_BOUNDS');
        for (const anom of oobAnoms) {
          const decision = rowRes.membershipDecision; // 'remove', 'keep', 'extend'
          if (decision === 'remove') {
            finalSplitWith = finalSplitWith.filter(name => name !== anom.user);
            anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Excluded ${anom.user} from split because she left the group.`);
          } else {
            anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Retained ${anom.user} in split despite membership warning.`);
          }
        }
      }

      // Handle external member Kabir
      if (row.anomalies.some(a => a.type === 'EXTERNAL_MEMBER_INCLUDED')) {
        const dec = rowRes.externalDecision; // 'add_kabir' or 'assign_dev'
        if (dec === 'assign_dev') {
          finalSplitWith = finalSplitWith.filter(name => name !== 'Kabir' && name !== "Dev's friend Kabir");
          if (!finalSplitWith.includes('Dev')) {
            finalSplitWith.push('Dev');
          }
          // The splits allocation below will assign Dev 2 shares or Kabir's amount.
          anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Reassigned Kabir's split share directly to Dev.`);
        } else {
          // Add Kabir. Ensure Kabir is in finalSplitWith
          finalSplitWith = finalSplitWith.map(name => {
            if (name === "Dev's friend Kabir") return 'Kabir';
            return name;
          });
          anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Added Kabir as a temporary member of the split.`);
        }
      }

      // Build Split calculation
      const splits = [];
      const splitType = row.splitType || 'equal';

      if (splitType === 'equal') {
        const count = finalSplitWith.length;
        const splitShare = Math.round((convertedAmount / count) * 100) / 100;
        
        // Adjust for rounding differences (assign small remaining diff to payer)
        let sumCalculated = 0;
        finalSplitWith.forEach((name, idx) => {
          const userObj = getUserObjByName(name);
          if (userObj) {
            let userShare = splitShare;
            if (idx === count - 1) {
              userShare = Math.round((convertedAmount - sumCalculated) * 100) / 100;
            }
            sumCalculated += userShare;
            splits.push({
              user_id: userObj.id,
              user_name: name,
              raw_split_value: 1, // equal share weight
              calculated_amount_inr: userShare
            });
          }
        });
      } 
      else if (splitType === 'unequal') {
        // Parse details: Rohan 700; Priya 400; Meera 400
        const detailsList = row.splitDetails.split(';').map(d => d.trim()).filter(Boolean);
        const userMapDetails = {};
        
        detailsList.forEach(detail => {
          const match = detail.match(/([a-zA-Z\s']+)\s+(\d+(?:\.\d+)?)/);
          if (match) {
            const rawName = match[1].trim();
            const normalizedName = USER_ALIASES[rawName.toLowerCase()] || rawName;
            userMapDetails[normalizedName] = parseFloat(match[2]);
          }
        });

        let conversionMultiplier = currency === 'USD' ? usdRate : 1.0;

        finalSplitWith.forEach(name => {
          const userObj = getUserObjByName(name);
          if (userObj) {
            const rawValue = userMapDetails[name] || 0;
            const calculatedAmount = Math.round(rawValue * conversionMultiplier * 100) / 100;
            splits.push({
              user_id: userObj.id,
              user_name: name,
              raw_split_value: rawValue,
              calculated_amount_inr: calculatedAmount
            });
          }
        });
      } 
      else if (splitType === 'percentage') {
        // Pizza Friday sum sum is 110%
        const detailsList = row.splitDetails.split(';').map(d => d.trim()).filter(Boolean);
        const userMapPct = {};
        let totalPct = 0;

        detailsList.forEach(detail => {
          const match = detail.match(/([a-zA-Z\s']+)\s+(\d+(?:\.\d+)?)\s*%/);
          if (match) {
            const rawName = match[1].trim();
            const normalizedName = USER_ALIASES[rawName.toLowerCase()] || rawName;
            const val = parseFloat(match[2]);
            userMapPct[normalizedName] = val;
            totalPct += val;
          }
        });

        const shouldNormalize = rowRes.percentageDecision === 'normalize' || Math.abs(totalPct - 100) > 0.01;

        finalSplitWith.forEach((name, idx) => {
          const userObj = getUserObjByName(name);
          if (userObj) {
            let rawVal = userMapPct[name] || 0;
            let finalPct = rawVal;
            
            if (shouldNormalize && totalPct > 0) {
              finalPct = (rawVal / totalPct) * 100;
            }

            const calculatedAmount = Math.round((convertedAmount * (finalPct / 100)) * 100) / 100;
            splits.push({
              user_id: userObj.id,
              user_name: name,
              raw_split_value: rawVal,
              calculated_amount_inr: calculatedAmount
            });
          }
        });

        if (shouldNormalize) {
          anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Normalized percentages from total ${totalPct}% to exactly 100%.`);
        }
      } 
      else if (splitType === 'share') {
        // Scooter rentals: Aisha 1; Rohan 2; Priya 1; Dev 2
        // If Kabir was reassigned to Dev:
        // Kabir's share was 1. We add Kabir's 1 share to Dev's 2 shares, so Dev has 3 shares.
        const detailsList = row.splitDetails.split(';').map(d => d.trim()).filter(Boolean);
        const userMapShares = {};
        
        detailsList.forEach(detail => {
          const match = detail.match(/([a-zA-Z\s']+)\s+(\d+(?:\.\d+)?)/);
          if (match) {
            const rawName = match[1].trim();
            const normalizedName = USER_ALIASES[rawName.toLowerCase()] || rawName;
            userMapShares[normalizedName] = parseFloat(match[2]);
          }
        });

        // Reassign Kabir's share to Dev if decision is assign_dev
        if (row.anomalies.some(a => a.type === 'EXTERNAL_MEMBER_INCLUDED') && rowRes.externalDecision === 'assign_dev') {
          const kabirShare = userMapShares['Kabir'] || userMapShares["Dev's friend Kabir"] || 1;
          userMapShares['Dev'] = (userMapShares['Dev'] || 0) + kabirShare;
          delete userMapShares['Kabir'];
        }

        let totalShares = 0;
        finalSplitWith.forEach(name => {
          totalShares += userMapShares[name] || 0;
        });

        finalSplitWith.forEach(name => {
          const userObj = getUserObjByName(name);
          if (userObj) {
            const userShare = userMapShares[name] || 0;
            const calculatedAmount = Math.round((convertedAmount * (userShare / totalShares)) * 100) / 100;
            splits.push({
              user_id: userObj.id,
              user_name: name,
              raw_split_value: userShare,
              calculated_amount_inr: calculatedAmount
            });
          }
        });
        anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Custom share split computed (Total shares: ${totalShares}).`);
      }

      resolvedExpenses.push({
        description: row.description,
        amount: row.amount,
        currency: row.currency,
        converted_amount_inr: convertedAmount,
        paid_by_user_id: payerUser.id,
        split_type: splitType,
        expense_date: finalDate,
        notes: row.notes,
        splits
      });
    }

    // Call save API
    try {
      const response = await fetch('/api/import/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: selectedGroupId,
          resolvedExpenses,
          resolvedSettlements
        })
      });

      const saveResult = await response.json();
      if (saveResult.success) {
        setImportReport({
          message: saveResult.message,
          anomalies: anomalyReportLines
        });
        setImportStep('success');
        loadInitialData(); // Refresh UI
        fetchBalances(); // Refresh balances
      } else {
        alert('Failed to save imported records: ' + saveResult.error);
      }
    } catch (e) {
      alert('Error saving imported records: ' + e.message);
    }
  };

  // Create manual group
  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!newGroupName) return;

    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGroupName,
          description: newGroupDesc,
          members: newGroupMembers
        })
      });
      const data = await res.json();
      if (data.success) {
        setNewGroupName('');
        setNewGroupDesc('');
        setNewGroupMembers([]);
        loadInitialData();
        alert('Group created successfully!');
      } else {
        alert('Failed: ' + data.error);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  // Create manual expense
  const handleAddExpense = async (e) => {
    e.preventDefault();
    const { description, amount, currency, paid_by_user_id, split_type, expense_date, notes, split_with, split_details } = manualExpense;
    
    if (!description || !amount || !paid_by_user_id || !split_type || !expense_date || split_with.length === 0) {
      alert('Please fill out all fields.');
      return;
    }

    const amtFloat = parseFloat(amount);
    let convertedInr = amtFloat;
    if (currency === 'USD') {
      convertedInr = Math.round(amtFloat * usdRate * 100) / 100;
    }

    // Calculate splits
    const splits = [];
    if (split_type === 'equal') {
      const splitShare = Math.round((convertedInr / split_with.length) * 100) / 100;
      split_with.forEach((userId, idx) => {
        let finalShare = splitShare;
        if (idx === split_with.length - 1) {
          // adjust rounding error
          const prevSum = splitShare * (split_with.length - 1);
          finalShare = Math.round((convertedInr - prevSum) * 100) / 100;
        }
        splits.push({
          user_id: parseInt(userId, 10),
          raw_split_value: 1,
          calculated_amount_inr: finalShare
        });
      });
    } 
    else if (split_type === 'unequal') {
      split_with.forEach(userId => {
        const val = parseFloat(split_details[userId] || 0);
        splits.push({
          user_id: parseInt(userId, 10),
          raw_split_value: val,
          calculated_amount_inr: currency === 'USD' ? Math.round(val * usdRate * 100) / 100 : val
        });
      });
    }
    else if (split_type === 'percentage') {
      split_with.forEach(userId => {
        const pct = parseFloat(split_details[userId] || 0);
        splits.push({
          user_id: parseInt(userId, 10),
          raw_split_value: pct,
          calculated_amount_inr: Math.round((convertedInr * (pct / 100)) * 100) / 100
        });
      });
    }
    else if (split_type === 'share') {
      let totalShares = 0;
      split_with.forEach(userId => {
        totalShares += parseFloat(split_details[userId] || 0);
      });
      split_with.forEach(userId => {
        const shares = parseFloat(split_details[userId] || 0);
        splits.push({
          user_id: parseInt(userId, 10),
          raw_split_value: shares,
          calculated_amount_inr: Math.round((convertedInr * (shares / totalShares)) * 100) / 100
        });
      });
    }

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: selectedGroupId,
          description,
          amount: amtFloat,
          currency,
          converted_amount_inr: convertedInr,
          paid_by_user_id: parseInt(paid_by_user_id, 10),
          split_type,
          expense_date,
          notes,
          splits
        })
      });
      const data = await res.json();
      if (data.success) {
        setManualExpense({
          description: '',
          amount: '',
          currency: 'INR',
          paid_by_user_id: '',
          split_type: 'equal',
          expense_date: new Date().toISOString().split('T')[0],
          notes: '',
          split_with: [],
          split_details: {}
        });
        fetchBalances();
        alert('Expense recorded successfully!');
      } else {
        alert('Failed: ' + data.error);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  // Add manual settlement
  const handleAddSettlement = async (e) => {
    e.preventDefault();
    const { payer_id, payee_id, amount, currency, settlement_date, notes } = manualSettlement;

    if (!payer_id || !payee_id || !amount || !settlement_date) {
      alert('Please fill out all fields.');
      return;
    }

    const amtFloat = parseFloat(amount);
    let convertedInr = amtFloat;
    if (currency === 'USD') {
      convertedInr = Math.round(amtFloat * usdRate * 100) / 100;
    }

    try {
      const res = await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: selectedGroupId,
          payer_id: parseInt(payer_id, 10),
          payee_id: parseInt(payee_id, 10),
          amount: amtFloat,
          currency,
          converted_amount_inr: convertedInr,
          settlement_date,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        setManualSettlement({
          payer_id: '',
          payee_id: '',
          amount: '',
          currency: 'INR',
          settlement_date: new Date().toISOString().split('T')[0],
          notes: ''
        });
        fetchBalances();
        alert('Settlement recorded successfully!');
      } else {
        alert('Failed: ' + data.error);
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="logo-section">
          <div className="logo-icon">S</div>
          <div>
            <h1>Spreetail Shared Expenses</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Splits tracker & Debt Minimization Wizard</p>
          </div>
        </div>
        
        {/* Group Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <label className="form-label" style={{ margin: 0 }}>Active Group:</label>
          <select 
            className="form-select" 
            style={{ width: '220px', padding: '0.5rem' }}
            value={selectedGroupId || ''}
            onChange={(e) => setSelectedGroupId(parseInt(e.target.value, 10))}
          >
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Tabs Menu */}
      <nav className="tabs-nav">
        <button className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
          Dashboard
        </button>
        <button className={`tab-btn ${activeTab === 'ledger' ? 'active' : ''}`} onClick={() => setActiveTab('ledger')}>
          Audit Ledger (Rohan)
        </button>
        <button className={`tab-btn ${activeTab === 'import' ? 'active' : ''}`} onClick={() => setActiveTab('import')}>
          CSV Ingestion Wizard
        </button>
        <button className={`tab-btn ${activeTab === 'groups' ? 'active' : ''}`} onClick={() => setActiveTab('groups')}>
          Group Timelines
        </button>
        <button className={`tab-btn ${activeTab === 'manual' ? 'active' : ''}`} onClick={() => setActiveTab('manual')}>
          Log Expense / Pay
        </button>
      </nav>

      {/* Tab Panels */}
      <main>
        {/* 1. DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <div className="dashboard-grid">
            <div>
              {/* Group Overview */}
              <div className="card" style={{ marginBottom: '2rem' }}>
                <h2 className="section-title">
                  Group Balances: {currentGroup ? currentGroup.name : 'No Group'}
                </h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                  {currentGroup?.description || 'Active group members and their net financial standing.'}
                </p>

                <div className="balance-card-grid">
                  {Object.keys(balances).length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>No transactions yet in this group.</p>
                  ) : (
                    Object.keys(balances).map(name => {
                      const val = balances[name];
                      const statusClass = val > 0.01 ? 'positive' : val < -0.01 ? 'negative' : 'neutral';
                      return (
                        <div key={name} className={`bal-card ${statusClass}`}>
                          <div className="bal-card-name">{name}</div>
                          <div className={`bal-card-val ${statusClass}`}>
                            {val > 0.01 ? `+₹${val.toLocaleString()}` : val < -0.01 ? `-₹${Math.abs(val).toLocaleString()}` : `₹0`}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                            {val > 0.01 ? 'Owed to them' : val < -0.01 ? 'Owes others' : 'Settled'}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Members Timeline List */}
              <div className="card">
                <h3 className="section-title">Active Members Timeline</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {currentGroup?.members?.map(m => (
                    <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <span style={{ fontWeight: '500' }}>{m.name}</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        Joined: {m.joined_at} {m.left_at ? `| Left: ${m.left_at}` : '(Current)'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 1b. AISHA'S VIEW (DEBT MINIMIZATION) */}
            <div>
              <div className="card">
                <h2 className="section-title">Aisha's View: Debt Settlement</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                  "I just want one number per person. Who pays whom, how much, done."
                </p>

                {payments.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎉</div>
                    <p>All group balances are perfectly settled!</p>
                  </div>
                ) : (
                  <div className="settlement-list">
                    {payments.map((p, idx) => (
                      <div key={idx} className="settlement-item">
                        <div className="settlement-payer-payee">
                          <span style={{ color: 'var(--color-danger)' }}>{p.from}</span>
                          <span className="settlement-arrow">➔</span>
                          <span style={{ color: 'var(--color-success)' }}>{p.to}</span>
                        </div>
                        <div className="settlement-amount">₹{p.amount.toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 2. LEDGER TAB (ROHAN'S VIEW) */}
        {activeTab === 'ledger' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h2>Rohan's View: Individual Balance Ledger</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  "No magic numbers. If the app says I owe, I want to see exactly which expenses make that up."
                </p>
              </div>

              {/* Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <label className="form-label" style={{ margin: 0 }}>Select Member:</label>
                <select 
                  className="form-select"
                  value={auditUser}
                  onChange={(e) => setAuditUser(e.target.value)}
                  style={{ width: '180px' }}
                >
                  {currentGroup?.members?.map(m => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="ledger-table-container">
              {ledger.length === 0 ? (
                <p style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No ledger entries found for {auditUser} in this group.
                </p>
              ) : (
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Type</th>
                      <th>Total Amount</th>
                      <th>Paid By</th>
                      <th>My Share</th>
                      <th>Balance Change</th>
                      <th>Running Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map(entry => (
                      <tr key={entry.id}>
                        <td>{entry.date}</td>
                        <td>
                          <div style={{ fontWeight: '500' }}>{entry.description}</div>
                          {entry.notes && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              Note: {entry.notes}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${entry.type === 'expense' ? 'badge-info' : 'badge-success'}`}>
                            {entry.type}
                          </span>
                        </td>
                        <td>
                          {entry.currency !== 'INR' && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>
                              ({entry.originalAmount} {entry.currency})
                            </span>
                          )}
                          ₹{entry.totalAmount.toLocaleString()}
                        </td>
                        <td>{entry.paidBy}</td>
                        <td>{entry.myShare > 0 ? `₹${entry.myShare.toLocaleString()}` : '-'}</td>
                        <td className={entry.netChange > 0 ? 'ledger-change-pos' : entry.netChange < 0 ? 'ledger-change-neg' : ''}>
                          {entry.netChange > 0 
                            ? `+₹${entry.netChange.toLocaleString()}` 
                            : entry.netChange < 0 
                              ? `-₹${Math.abs(entry.netChange).toLocaleString()}` 
                              : `₹0`
                          }
                        </td>
                        <td style={{ fontWeight: '600' }} className={entry.runningBalance > 0 ? 'ledger-change-pos' : entry.runningBalance < 0 ? 'ledger-change-neg' : ''}>
                          ₹{entry.runningBalance.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* 3. CSV IMPORT WIZARD */}
        {activeTab === 'import' && (
          <div className="card">
            <h2>CSV Ingestion Wizard</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              Import `expenses_export.csv` directly. Our validator detects and surfaces 12+ types of deliberate anomalies so you can review and resolve them before saving.
            </p>

            {/* Step 1: Upload */}
            {importStep === 'upload' && (
              <div>
                <div 
                  className="dropzone"
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current.click()}
                >
                  <div className="dropzone-icon">📥</div>
                  <h3>Drag and drop your expenses export CSV here</h3>
                  <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                    Or click to browse files from your computer
                  </p>
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept=".csv"
                    onChange={handleFileUpload}
                  />
                </div>
              </div>
            )}

            {/* Step 2: Resolve Anomalies */}
            {importStep === 'resolve' && parsedCSV && (
              <div>
                <div className="wizard-header">
                  <div className="step-indicator">
                    Reviewing {parsedCSV.records.length} CSV Rows
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <label className="form-label" style={{ margin: 0 }}>USD Conversion Rate (₹ per $):</label>
                    <input 
                      type="number"
                      className="form-input"
                      style={{ width: '80px', padding: '0.35rem' }}
                      value={usdRate}
                      onChange={(e) => setUsdRate(parseFloat(e.target.value) || 1.0)}
                    />
                  </div>
                </div>

                <h3>Detected Data Anomalies ({parsedCSV.records.reduce((acc, r) => acc + r.anomalies.length, 0) + parsedCSV.duplicates.length} total)</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                  Please confirm policies and select resolutions where required.
                </p>

                <div className="anomaly-list">
                  {/* Render Duplicate Groups */}
                  {parsedCSV.duplicates.map((dup, dIdx) => {
                    const key = `${dup.indexA}_${dup.indexB}`;
                    return (
                      <div key={`dup-${key}`} className="anomaly-card has-error">
                        <div className="anomaly-meta">
                          <span className="anomaly-title">Duplicate / Conflict Entry Conflict</span>
                          <span className="badge badge-danger">High Severity</span>
                        </div>
                        <p className="anomaly-details">{dup.description}</p>
                        
                        <div className="resolution-box">
                          <span className="form-label">Resolution Action:</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                              <input 
                                type="radio" 
                                name={`dup-choice-${key}`}
                                checked={selectedDuplicates[key] === 'keepA'}
                                onChange={() => setSelectedDuplicates(prev => ({ ...prev, [key]: 'keepA' }))}
                              />
                              <span>Keep Row {dup.rowA.rowNum} ("{dup.rowA.description}") and discard Row {dup.rowB.rowNum}</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                              <input 
                                type="radio" 
                                name={`dup-choice-${key}`}
                                checked={selectedDuplicates[key] === 'keepB'}
                                onChange={() => setSelectedDuplicates(prev => ({ ...prev, [key]: 'keepB' }))}
                              />
                              <span>Keep Row {dup.rowB.rowNum} ("{dup.rowB.description}") and discard Row {dup.rowA.rowNum}</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                              <input 
                                type="radio" 
                                name={`dup-choice-${key}`}
                                checked={selectedDuplicates[key] === 'keepBoth'}
                                onChange={() => setSelectedDuplicates(prev => ({ ...prev, [key]: 'keepBoth' }))}
                              />
                              <span>Keep both records as separate, distinct transactions</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                              <input 
                                type="radio" 
                                name={`dup-choice-${key}`}
                                checked={selectedDuplicates[key] === 'deleteBoth'}
                                onChange={() => setSelectedDuplicates(prev => ({ ...prev, [key]: 'deleteBoth' }))}
                              />
                              <span style={{ color: 'var(--color-danger)' }}>Discard/Delete both records</span>
                            </label>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Render Row Specific Anomalies */}
                  {parsedCSV.records.map((row) => {
                    if (row.anomalies.length === 0) return null;
                    
                    return row.anomalies.map((anom, aIdx) => {
                      const id = `anom-${row.rowNum}-${aIdx}`;
                      const hasHigh = anom.severity === 'HIGH';
                      const hasMedium = anom.severity === 'MEDIUM';
                      const cardClass = hasHigh ? 'has-error' : hasMedium ? 'has-warning' : 'info';
                      const badgeClass = hasHigh ? 'badge-danger' : hasMedium ? 'badge-warning' : 'badge-info';

                      return (
                        <div key={id} className={`anomaly-card ${cardClass}`}>
                          <div className="anomaly-meta">
                            <span className="anomaly-title">
                              Row {row.rowNum} Anomaly: {anom.type} ({row.description})
                            </span>
                            <span className={`badge ${badgeClass}`}>{anom.severity}</span>
                          </div>
                          <p className="anomaly-details">{anom.message}</p>

                          {/* Interactive resolutions based on anomaly type */}
                          {anom.type === 'PAYER_MISSING' && (
                            <div className="resolution-box">
                              <label className="form-label">Select Payer for this expense:</label>
                              <select 
                                className="form-select"
                                value={resolutions[row.rowNum]?.payerDecision || ''}
                                onChange={(e) => updateResolution(row.rowNum, 'payerDecision', e.target.value)}
                              >
                                <option value="">-- Choose Payer --</option>
                                {systemUsers.map(u => (
                                  <option key={u.id} value={u.name}>{u.name}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {anom.type === 'DATE_AMBIGUOUS' && (
                            <div className="resolution-box">
                              <span className="form-label">Resolve Ambiguous Date format (04-05-2026):</span>
                              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                  <input 
                                    type="radio" 
                                    name={`date-choice-${row.rowNum}`}
                                    checked={resolutions[row.rowNum]?.dateDecision === '05-04-2026'}
                                    onChange={() => updateResolution(row.rowNum, 'dateDecision', '05-04-2026')}
                                  />
                                  <span>April 5, 2026 (DD-MM-YYYY)</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                  <input 
                                    type="radio" 
                                    name={`date-choice-${row.rowNum}`}
                                    checked={resolutions[row.rowNum]?.dateDecision === '04-05-2026'}
                                    onChange={() => updateResolution(row.rowNum, 'dateDecision', '04-05-2026')}
                                  />
                                  <span>May 4, 2026 (MM-DD-YYYY)</span>
                                </label>
                              </div>
                            </div>
                          )}

                          {anom.type === 'PERCENTAGE_SUM_ERROR' && (
                            <div className="resolution-box">
                              <span className="form-label">Resolve percentage summation ({anom.currentSum}%):</span>
                              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                  <input 
                                    type="radio" 
                                    name={`pct-choice-${row.rowNum}`}
                                    checked={resolutions[row.rowNum]?.percentageDecision === 'normalize'}
                                    onChange={() => updateResolution(row.rowNum, 'percentageDecision', 'normalize')}
                                  />
                                  <span>Auto-Normalize percentages to sum to 100% (Weighted)</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                  <input 
                                    type="radio" 
                                    name={`pct-choice-${row.rowNum}`}
                                    checked={resolutions[row.rowNum]?.percentageDecision === 'as_is'}
                                    onChange={() => updateResolution(row.rowNum, 'percentageDecision', 'as_is')}
                                  />
                                  <span style={{ color: 'var(--color-danger)' }}>Import as-is (May result in unbalanced calculations)</span>
                                </label>
                              </div>
                            </div>
                          )}

                          {anom.type === 'MEMBERSHIP_OUT_OF_BOUNDS' && (
                            <div className="resolution-box">
                              <span className="form-label">Resolve membership timeline conflict for {anom.user}:</span>
                              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                  <input 
                                    type="radio" 
                                    name={`mem-choice-${row.rowNum}-${anom.user}`}
                                    checked={resolutions[row.rowNum]?.membershipDecision === 'remove'}
                                    onChange={() => updateResolution(row.rowNum, 'membershipDecision', 'remove')}
                                  />
                                  <span>Remove {anom.user} from this split & re-split among active members</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                  <input 
                                    type="radio" 
                                    name={`mem-choice-${row.rowNum}-${anom.user}`}
                                    checked={resolutions[row.rowNum]?.membershipDecision === 'keep'}
                                    onChange={() => updateResolution(row.rowNum, 'membershipDecision', 'keep')}
                                  />
                                  <span>Force include {anom.user} in split (e.g. they still owe)</span>
                                </label>
                              </div>
                            </div>
                          )}

                          {anom.type === 'EXTERNAL_MEMBER_INCLUDED' && (
                            <div className="resolution-box">
                              <span className="form-label">Handle unrecognized member {anom.user}:</span>
                              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                  <input 
                                    type="radio" 
                                    name={`ext-choice-${row.rowNum}-${anom.user}`}
                                    checked={resolutions[row.rowNum]?.externalDecision === 'add_kabir'}
                                    onChange={() => updateResolution(row.rowNum, 'externalDecision', 'add_kabir')}
                                  />
                                  <span>Add Kabir as a temporary member of this split</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                  <input 
                                    type="radio" 
                                    name={`ext-choice-${row.rowNum}-${anom.user}`}
                                    checked={resolutions[row.rowNum]?.externalDecision === 'assign_dev'}
                                    onChange={() => updateResolution(row.rowNum, 'externalDecision', 'assign_dev')}
                                  />
                                  <span>Assign {anom.user}'s share to Dev (Dev absorbs Kabir's cost)</span>
                                </label>
                              </div>
                            </div>
                          )}

                          {!['PAYER_MISSING', 'DATE_AMBIGUOUS', 'PERCENTAGE_SUM_ERROR', 'MEMBERSHIP_OUT_OF_BOUNDS', 'EXTERNAL_MEMBER_INCLUDED'].includes(anom.type) && (
                            <div style={{ fontSize: '0.85rem', color: 'var(--color-success)', fontStyle: 'italic', marginTop: '0.25rem' }}>
                              Auto-resolved policy will be applied (see details).
                            </div>
                          )}
                        </div>
                      );
                    });
                  })}
                </div>

                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" onClick={() => setImportStep('upload')}>
                    Back / Cancel
                  </button>
                  <button className="btn btn-primary" onClick={executeImport}>
                    Apply Resolutions & Import
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Success */}
            {importStep === 'success' && importReport && (
              <div>
                <div style={{ textAlign: 'center', padding: '2rem', background: 'rgba(16, 185, 129, 0.05)', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.2)', marginBottom: '2rem' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>✅</div>
                  <h3 style={{ color: 'var(--color-success)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>Import Succeeded!</h3>
                  <p>{importReport.message}</p>
                </div>

                <h3>Ingestion Report (Anomaly Resolution Log)</h3>
                <div style={{ background: '#070a10', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem', maxHeight: '300px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.75rem' }}>
                  {importReport.anomalies.map((line, idx) => (
                    <div key={idx} style={{ marginBottom: '0.4rem', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.2rem' }}>{line}</div>
                  ))}
                </div>

                <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-primary" onClick={() => { setImportStep('upload'); setParsedCSV(null); }}>
                    Import Another File
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4. GROUP TIMELINES */}
        {activeTab === 'groups' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
            <div className="card">
              <h2>Group Membership Timelines</h2>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                Define active membership date ranges for flatmates to ensure expenses are split correctly over time.
              </p>

              {groups.map(g => (
                <div key={g.id} style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.25rem', background: selectedGroupId === g.id ? 'rgba(20, 184, 166, 0.03)' : 'transparent' }}>
                  <h4 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>{g.name}</h4>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>{g.description}</p>
                  
                  <h5 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Members & Dates:</h5>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {g.members.map(m => (
                      <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.01)', padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.9rem' }}>
                        <span>{m.name}</span>
                        <span style={{ color: 'var(--color-primary)' }}>
                          {m.joined_at} to {m.left_at || 'Present'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Create Group Form */}
            <div className="card">
              <h2>Create New Group</h2>
              <form onSubmit={handleCreateGroup} style={{ marginTop: '1.5rem' }}>
                <div className="form-group">
                  <label className="form-label">Group Name</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g. Flat 4B"
                    value={newGroupName} 
                    onChange={(e) => setNewGroupName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g. Monthly rent and household utilities"
                    value={newGroupDesc} 
                    onChange={(e) => setNewGroupDesc(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <span className="form-label">Select Group Members & Dates:</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                    {systemUsers.map(user => {
                      const isChecked = newGroupMembers.some(m => m.user_id === user.id);
                      const membershipVal = newGroupMembers.find(m => m.user_id === user.id) || {};
                      
                      return (
                        <div key={user.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(0,0,0,0.1)', padding: '0.5rem 0.75rem', borderRadius: '8px' }}>
                          <input 
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewGroupMembers(prev => [...prev, {
                                  user_id: user.id,
                                  name: user.name,
                                  joined_at: '2026-02-01',
                                  left_at: ''
                                }]);
                              } else {
                                setNewGroupMembers(prev => prev.filter(m => m.user_id !== user.id));
                              }
                            }}
                          />
                          <span style={{ width: '80px', fontWeight: '500' }}>{user.name}</span>
                          
                          {isChecked && (
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1 }}>
                              <input 
                                type="date" 
                                className="form-input"
                                style={{ padding: '0.25rem', fontSize: '0.8rem' }}
                                value={membershipVal.joined_at || ''}
                                onChange={(e) => {
                                  setNewGroupMembers(prev => prev.map(m => {
                                    if (m.user_id === user.id) return { ...m, joined_at: e.target.value };
                                    return m;
                                  }));
                                }}
                              />
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>to</span>
                              <input 
                                type="date" 
                                className="form-input"
                                style={{ padding: '0.25rem', fontSize: '0.8rem' }}
                                value={membershipVal.left_at || ''}
                                onChange={(e) => {
                                  setNewGroupMembers(prev => prev.map(m => {
                                    if (m.user_id === user.id) return { ...m, left_at: e.target.value };
                                    return m;
                                  }));
                                }}
                                placeholder="Present"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                  Create Group
                </button>
              </form>
            </div>
          </div>
        )}

        {/* 5. LOG MANUAL TRANSACTION */}
        {activeTab === 'manual' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
            {/* Form 1: Add Expense */}
            <div className="card">
              <h2>Log Shared Expense</h2>
              <form onSubmit={handleAddExpense} style={{ marginTop: '1.5rem' }}>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g. Internet Broadband" 
                    value={manualExpense.description}
                    onChange={(e) => setManualExpense(prev => ({ ...prev, description: e.target.value }))}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Amount</label>
                    <input 
                      type="number" 
                      step="0.01"
                      className="form-input" 
                      placeholder="0.00" 
                      value={manualExpense.amount}
                      onChange={(e) => setManualExpense(prev => ({ ...prev, amount: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Currency</label>
                    <select 
                      className="form-select"
                      value={manualExpense.currency}
                      onChange={(e) => setManualExpense(prev => ({ ...prev, currency: e.target.value }))}
                    >
                      <option value="INR">INR (₹)</option>
                      <option value="USD">USD ($)</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Paid By</label>
                    <select 
                      className="form-select"
                      value={manualExpense.paid_by_user_id}
                      onChange={(e) => setManualExpense(prev => ({ ...prev, paid_by_user_id: e.target.value }))}
                      required
                    >
                      <option value="">-- Select Payer --</option>
                      {currentGroup?.members?.map(m => (
                        <option key={m.id} value={m.user_id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date</label>
                    <input 
                      type="date" 
                      className="form-input"
                      value={manualExpense.expense_date}
                      onChange={(e) => setManualExpense(prev => ({ ...prev, expense_date: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Split Type</label>
                  <select 
                    className="form-select"
                    value={manualExpense.split_type}
                    onChange={(e) => setManualExpense(prev => ({ ...prev, split_type: e.target.value, split_details: {} }))}
                  >
                    <option value="equal">Split Equally</option>
                    <option value="unequal">Unequal Amounts</option>
                    <option value="percentage">Percentage Split</option>
                    <option value="share">Share Weights</option>
                  </select>
                </div>

                <div className="form-group">
                  <span className="form-label">Split With:</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                    {currentGroup?.members?.map(m => {
                      const isChecked = manualExpense.split_with.includes(m.user_id);
                      return (
                        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <input 
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setManualExpense(prev => ({ ...prev, split_with: [...prev.split_with, m.user_id] }));
                              } else {
                                setManualExpense(prev => ({ ...prev, split_with: prev.split_with.filter(id => id !== m.user_id) }));
                              }
                            }}
                          />
                          <span style={{ width: '80px' }}>{m.name}</span>
                          
                          {isChecked && manualExpense.split_type !== 'equal' && (
                            <input 
                              type="number"
                              className="form-input"
                              style={{ width: '100px', padding: '0.25rem 0.5rem' }}
                              placeholder={
                                manualExpense.split_type === 'unequal' ? 'Amount' : 
                                manualExpense.split_type === 'percentage' ? '%' : 'Share'
                              }
                              value={manualExpense.split_details[m.user_id] || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setManualExpense(prev => ({
                                  ...prev,
                                  split_details: {
                                    ...prev.split_details,
                                    [m.user_id]: val
                                  }
                                }));
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <textarea 
                    className="form-textarea" 
                    rows="2"
                    placeholder="Extra details..."
                    value={manualExpense.notes}
                    onChange={(e) => setManualExpense(prev => ({ ...prev, notes: e.target.value }))}
                  />
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  Add Shared Expense
                </button>
              </form>
            </div>

            {/* Form 2: Record Settlement */}
            <div className="card">
              <h2>Record Payment / Settlement</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                Log peer-to-peer cash payments made to settle outstanding debts directly.
              </p>

              <form onSubmit={handleAddSettlement}>
                <div className="form-group">
                  <label className="form-label">From (Payer)</label>
                  <select 
                    className="form-select"
                    value={manualSettlement.payer_id}
                    onChange={(e) => setManualSettlement(prev => ({ ...prev, payer_id: e.target.value }))}
                    required
                  >
                    <option value="">-- Select Debtor --</option>
                    {currentGroup?.members?.map(m => (
                      <option key={m.id} value={m.user_id}>{m.name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">To (Payee)</label>
                  <select 
                    className="form-select"
                    value={manualSettlement.payee_id}
                    onChange={(e) => setManualSettlement(prev => ({ ...prev, payee_id: e.target.value }))}
                    required
                  >
                    <option value="">-- Select Creditor --</option>
                    {currentGroup?.members?.map(m => (
                      <option key={m.id} value={m.user_id}>{m.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Amount</label>
                    <input 
                      type="number" 
                      step="0.01"
                      className="form-input" 
                      placeholder="0.00" 
                      value={manualSettlement.amount}
                      onChange={(e) => setManualSettlement(prev => ({ ...prev, amount: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Currency</label>
                    <select 
                      className="form-select"
                      value={manualSettlement.currency}
                      onChange={(e) => setManualSettlement(prev => ({ ...prev, currency: e.target.value }))}
                    >
                      <option value="INR">INR (₹)</option>
                      <option value="USD">USD ($)</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Settlement Date</label>
                  <input 
                    type="date" 
                    className="form-input"
                    value={manualSettlement.settlement_date}
                    onChange={(e) => setManualSettlement(prev => ({ ...prev, settlement_date: e.target.value }))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g. Sent via UPI" 
                    value={manualSettlement.notes}
                    onChange={(e) => setManualSettlement(prev => ({ ...prev, notes: e.target.value }))}
                  />
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                  Record Payment
                </button>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
