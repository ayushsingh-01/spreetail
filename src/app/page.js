'use client';

import React, { useState, useEffect, useRef } from 'react';

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
  const [loggedInUser, setLoggedInUser] = useState(null);
  
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

  const [quickSettleAmount, setQuickSettleAmount] = useState('');
  const [quickSettlePayeeId, setQuickSettlePayeeId] = useState('');

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

  const handleResetDatabase = async () => {
    if (!confirm('Are you sure you want to clear all data and reset the database? This will delete all imported and custom expenses.')) return;
    try {
      const res = await fetch('/api/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert('Database successfully reset and re-seeded!');
        await loadInitialData();
        await fetchBalances();
      } else {
        alert('Reset failed: ' + data.error);
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const handleLogin = (user) => {
    setLoggedInUser(user);
    setAuditUser(user.name);
    localStorage.setItem('expenses_logged_in_user', JSON.stringify(user));
  };

  const handleLogout = () => {
    setLoggedInUser(null);
    localStorage.removeItem('expenses_logged_in_user');
  };

  useEffect(() => {
    loadInitialData();
    const savedUser = localStorage.getItem('expenses_logged_in_user');
    if (savedUser) {
      try {
        const user = JSON.parse(savedUser);
        setLoggedInUser(user);
        setAuditUser(user.name);
      } catch (err) {
        console.error(err);
      }
    }
  }, []);

  // Recalculate balances whenever selected group or audit user changes
  useEffect(() => {
    if (selectedGroupId) {
      fetchBalances();
    }
  }, [selectedGroupId, auditUser]);

  // Keep manual forms payer matched to loggedInUser
  useEffect(() => {
    if (loggedInUser) {
      setManualExpense(prev => ({ ...prev, paid_by_user_id: String(loggedInUser.id) }));
      setManualSettlement(prev => ({ ...prev, payer_id: String(loggedInUser.id) }));
    }
  }, [loggedInUser]);

  // Keep quick settle widget matched to outstanding debts
  useEffect(() => {
    const myDebts = payments.filter(p => p.from === loggedInUser?.name);
    if (myDebts.length > 0) {
      const firstDebt = myDebts[0];
      const targetUser = currentGroup?.members?.find(m => m.name === firstDebt.to);
      if (targetUser) {
        setQuickSettlePayeeId(String(targetUser.user_id));
        setQuickSettleAmount(String(firstDebt.amount));
      }
    } else {
      setQuickSettlePayeeId('');
      setQuickSettleAmount('');
    }
  }, [payments, loggedInUser, selectedGroupId]);

  const handleQuickSettleSubmit = async (e) => {
    e.preventDefault();
    if (!quickSettlePayeeId || !quickSettleAmount) {
      alert('Please select a creditor and input an amount.');
      return;
    }
    const amtFloat = parseFloat(quickSettleAmount);
    if (isNaN(amtFloat) || amtFloat <= 0) {
      alert('Please enter a positive settlement amount.');
      return;
    }

    try {
      const res = await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: selectedGroupId,
          payer_id: loggedInUser.id,
          payee_id: parseInt(quickSettlePayeeId, 10),
          amount: amtFloat,
          currency: 'INR',
          converted_amount_inr: amtFloat,
          settlement_date: new Date().toISOString().split('T')[0],
          notes: 'Settled via Quick Settle Dashboard Widget'
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Settlement successfully recorded!');
        setQuickSettleAmount('');
        fetchBalances();
      } else {
        alert('Failed to settle: ' + data.error);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

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
          
          // Set default group decision using suggestedGroup
          const matchedGroup = data.systemGroups?.find(g => g.name === row.suggestedGroup) || 
                               groups.find(g => g.name === row.suggestedGroup) || 
                               groups[0];
          rowRes.groupDecision = matchedGroup ? matchedGroup.id : null;
          
          row.anomalies.forEach(anom => {
            if (anom.type === 'DATE_AMBIGUOUS') {
              rowRes.dateDecision = 'DD-MM-YYYY'; // Default to DD-MM-YYYY format
            }
            if (anom.type === 'PAYER_MISSING') {
              rowRes.payerDecision = ''; // User must select
            }
            if (anom.type === 'PERCENTAGE_SUM_ERROR') {
              rowRes.percentageDecision = 'normalize'; // Default normalize
            }
            if (anom.type === 'MEMBERSHIP_OUT_OF_BOUNDS') {
              const isPayer = row.paidByNormalized === anom.user;
              const hasVisitingNote = (row.notes || '').toLowerCase().includes('visit') || 
                                      (row.description || '').toLowerCase().includes('visit');
              rowRes.membershipDecision = (isPayer || hasVisitingNote) ? 'keep' : 'remove';
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
      const rowGroupId = rowRes.groupDecision || selectedGroupId;
      const targetGroupObj = groups.find(g => g.id === rowGroupId);
      const targetGroupName = targetGroupObj ? targetGroupObj.name : 'Unknown Group';

      // Date Resolution
      let finalDate = row.date;
      if (row.anomalies.some(a => a.type === 'DATE_AMBIGUOUS')) {
        const decision = rowRes.dateDecision; // 'DD-MM-YYYY' or 'MM-DD-YYYY'
        if (decision === 'MM-DD-YYYY') {
          const [yyyy, mm, dd] = row.date.split('-');
          finalDate = `${yyyy}-${dd}-${mm}`;
          anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Ambiguous date resolved to MM-DD-YYYY (${finalDate}).`);
        } else {
          finalDate = row.date;
          anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Ambiguous date resolved to default DD-MM-YYYY (${finalDate}).`);
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
        const payeeName = row.splitWithNormalized[0];
        resolvedSettlements.push({
          groupId: rowGroupId,
          payer_name: payerName,
          payee_name: payeeName,
          amount,
          currency,
          converted_amount_inr: convertedAmount,
          settlement_date: finalDate,
          notes: row.notes || 'Imported peer-to-peer settlement'
        });
        anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Logged directly as a Settlement of INR ${convertedAmount} from ${payerName} to ${payeeName} in group "${targetGroupName}".`);
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
          anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Reassigned Kabir's split share directly to Dev.`);
        } else {
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
          let userShare = splitShare;
          if (idx === count - 1) {
            userShare = Math.round((convertedAmount - sumCalculated) * 100) / 100;
          }
          sumCalculated += userShare;
          splits.push({
            user_name: name,
            raw_split_value: 1, // equal share weight
            calculated_amount_inr: userShare
          });
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
          const rawValue = userMapDetails[name] || 0;
          const calculatedAmount = Math.round(rawValue * conversionMultiplier * 100) / 100;
          splits.push({
            user_name: name,
            raw_split_value: rawValue,
            calculated_amount_inr: calculatedAmount
          });
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
          let rawVal = userMapPct[name] || 0;
          let finalPct = rawVal;
          
          if (shouldNormalize && totalPct > 0) {
            finalPct = (rawVal / totalPct) * 100;
          }

          const calculatedAmount = Math.round((convertedAmount * (finalPct / 100)) * 100) / 100;
          splits.push({
            user_name: name,
            raw_split_value: rawVal,
            calculated_amount_inr: calculatedAmount
          });
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
          const userShare = userMapShares[name] || 0;
          const calculatedAmount = Math.round((convertedAmount * (userShare / totalShares)) * 100) / 100;
          splits.push({
            user_name: name,
            raw_split_value: userShare,
            calculated_amount_inr: calculatedAmount
          });
        });
        anomalyReportLines.push(`Row ${row.rowNum} ("${row.description}"): Custom share split computed (Total shares: ${totalShares}).`);
      }

      resolvedExpenses.push({
        groupId: rowGroupId,
        description: row.description,
        amount: row.amount,
        currency: row.currency,
        converted_amount_inr: convertedAmount,
        paid_by_name: payerName,
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
    const finalPayerId = paid_by_user_id || String(loggedInUser?.id || '');
    
    if (!description || !amount || !finalPayerId || !split_type || !expense_date || split_with.length === 0) {
      alert('Please fill out all fields and select at least one split participant.');
      return;
    }

    const amtFloat = parseFloat(amount);
    if (isNaN(amtFloat) || amtFloat <= 0) {
      alert('Expense amount must be a positive number.');
      return;
    }

    // Validation for split distributions
    if (split_type === 'percentage') {
      let sumPct = 0;
      split_with.forEach(id => {
        sumPct += parseFloat(split_details[id] || 0);
      });
      if (Math.abs(sumPct - 100) > 0.01) {
        alert(`The split percentages must sum to exactly 100%. Currently it is ${sumPct}%.`);
        return;
      }
    } else if (split_type === 'unequal') {
      let sumAmt = 0;
      split_with.forEach(id => {
        sumAmt += parseFloat(split_details[id] || 0);
      });
      if (Math.abs(sumAmt - amtFloat) > 0.01) {
        alert(`The sum of split amounts (₹${sumAmt}) must equal the total expense amount (₹${amtFloat}).`);
        return;
      }
    } else if (split_type === 'share') {
      let sumShares = 0;
      split_with.forEach(id => {
        sumShares += parseFloat(split_details[id] || 0);
      });
      if (sumShares <= 0) {
        alert('The sum of split share weights must be greater than 0.');
        return;
      }
    }
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
          paid_by_user_id: parseInt(finalPayerId, 10),
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
          paid_by_user_id: String(loggedInUser?.id || ''),
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
    const finalPayerId = payer_id || String(loggedInUser?.id || '');

    if (!finalPayerId || !payee_id || !amount || !settlement_date) {
      alert('Please fill out all fields.');
      return;
    }

    const amtFloat = parseFloat(amount);
    if (isNaN(amtFloat) || amtFloat <= 0) {
      alert('Settlement amount must be a positive number.');
      return;
    }

    if (parseInt(finalPayerId, 10) === parseInt(payee_id, 10)) {
      alert('Payer and Payee cannot be the same person.');
      return;
    }
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
          payer_id: parseInt(finalPayerId, 10),
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
          payer_id: String(loggedInUser?.id || ''),
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

  if (!loggedInUser) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: '#f8fafc', padding: '2rem' }}>
        <div className="card" style={{ width: '100%', maxWidth: '420px', padding: '2.5rem', border: '1px solid var(--border-color)', borderRadius: '20px', boxShadow: '0 10px 30px rgba(0, 0, 0, 0.03)', backgroundColor: '#ffffff' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{ width: '48px', height: '48px', backgroundColor: 'var(--color-primary)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '1.5rem', fontWeight: '800', margin: '0 auto 1rem auto' }}>F</div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Welcome to Fynix</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              Securely track, audit, and split expenses. Select a profile to log in.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <span className="form-label" style={{ fontWeight: '750', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Flatmate Profiles:</span>
            {systemUsers.map(user => (
              <button 
                key={user.id} 
                className="btn btn-secondary" 
                style={{ justifyContent: 'space-between', padding: '0.85rem 1.25rem', borderRadius: '12px', display: 'flex', width: '100%', alignItems: 'center' }}
                onClick={() => handleLogin(user)}
              >
                <span style={{ fontWeight: '600' }}>👤 {user.name}</span>
                <span style={{ color: 'var(--color-primary)', fontWeight: '700', fontSize: '0.85rem' }}>Enter Fynix ➔</span>
              </button>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
            <span className="form-label" style={{ fontWeight: '750', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Create New Profile:</span>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const name = e.target.username.value.trim();
              if (!name) return;
              
              try {
                const res = await fetch('/api/users', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name, email: `${name.toLowerCase()}@example.com` })
                });
                const user = await res.json();
                if (user.error) {
                  alert(user.error);
                } else {
                  await loadInitialData();
                  handleLogin(user);
                }
              } catch (err) {
                alert('Sign up failed: ' + err.message);
              }
            }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input 
                  type="text" 
                  name="username"
                  className="form-input" 
                  style={{ borderRadius: '10px' }}
                  placeholder="Enter name..." 
                  required
                />
                <button type="submit" className="btn btn-primary" style={{ whiteSpace: 'nowrap', borderRadius: '10px' }}>
                  Register
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const getRowsToSkip = () => {
    const skipSet = new Set();
    if (parsedCSV && parsedCSV.duplicates) {
      parsedCSV.duplicates.forEach(dup => {
        const key = `${dup.indexA}_${dup.indexB}`;
        const choice = selectedDuplicates[key];
        if (choice === 'keepA') {
          skipSet.add(dup.rowB.rowNum);
        } else if (choice === 'keepB') {
          skipSet.add(dup.rowA.rowNum);
        } else if (choice === 'deleteBoth') {
          skipSet.add(dup.rowA.rowNum);
          skipSet.add(dup.rowB.rowNum);
        }
      });
    }
    return skipSet;
  };
  const rowsToSkip = getRowsToSkip();

  const myDebts = payments.filter(p => p.from === loggedInUser?.name);
  const myCredits = payments.filter(p => p.to === loggedInUser?.name);

  const formatDatePretty = (isoStr) => {
    if (!isoStr) return '';
    const [y, m, d] = isoStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const getCategory = (desc) => {
    const d = (desc || '').toLowerCase();
    if (d.includes('rent')) return 'Rent';
    if (d.includes('grocer') || d.includes('dmart') || d.includes('bigbasket') || d.includes('bites') || d.includes('dinner') || d.includes('pizza') || d.includes('swiggy') || d.includes('lunch') || d.includes('brunch') || d.includes('snack') || d.includes('drink') || d.includes('fruit') || d.includes('vegetable')) return 'Food & Dining';
    if (d.includes('wifi') || d.includes('internet') || d.includes('electric') || d.includes('maid') || d.includes('cylinder') || d.includes('cleaning') || d.includes('broadband') || d.includes('gas') || d.includes('water')) return 'Utilities';
    if (d.includes('flight') || d.includes('goa') || d.includes('villa') || d.includes('beach') || d.includes('scooter') || d.includes('airport') || d.includes('cab') || d.includes('parasailing') || d.includes('travel') || d.includes('taxi')) return 'Travel';
    return 'Others';
  };

  const getCategoryColor = (cat) => {
    switch (cat) {
      case 'Food & Dining': return '#f59e0b';
      case 'Utilities': return '#2563eb';
      case 'Travel': return '#10b981';
      case 'Rent': return '#ef4444';
      default: return '#64748b';
    }
  };

  const getCategoryIcon = (cat) => {
    switch (cat) {
      case 'Rent': return '🏠';
      case 'Food & Dining': return '🍔';
      case 'Utilities': return '⚡';
      case 'Travel': return '✈️';
      default: return '📦';
    }
  };

  const drawLineChart = () => {
    if (ledger.length === 0) return null;
    const sortedLedger = [...ledger].sort((a, b) => a.date.localeCompare(b.date));
    const vals = sortedLedger.map(e => e.runningBalance);
    const minVal = Math.min(...vals, 0);
    const maxVal = Math.max(...vals, 0);
    const range = maxVal - minVal || 1;

    const width = 360;
    const height = 150;
    const padding = 20;

    const points = sortedLedger.map((e, idx) => {
      const x = padding + (idx / (sortedLedger.length - 1 || 1)) * (width - 2 * padding);
      const y = height - padding - ((e.runningBalance - minVal) / range) * (height - 2 * padding);
      return { x, y, val: e.runningBalance, date: e.date };
    });

    let pathD = '';
    points.forEach((p, idx) => {
      if (idx === 0) pathD += `M ${p.x} ${p.y}`;
      else pathD += ` L ${p.x} ${p.y}`;
    });

    let areaD = pathD;
    if (points.length > 0) {
      areaD += ` L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;
    }

    return { points, pathD, areaD, width, height, padding, minVal, maxVal };
  };

  const drawDoughnutChart = () => {
    const expenseLedger = ledger.filter(e => e.type === 'expense');
    let sumFood = 0;
    let sumUtilities = 0;
    let sumTravel = 0;
    let sumRent = 0;
    let sumOther = 0;

    expenseLedger.forEach(e => {
      const cat = getCategory(e.description);
      const amt = e.totalAmount;
      if (cat === 'Food & Dining') sumFood += amt;
      else if (cat === 'Utilities') sumUtilities += amt;
      else if (cat === 'Travel') sumTravel += amt;
      else if (cat === 'Rent') sumRent += amt;
      else sumOther += amt;
    });

    const total = sumFood + sumUtilities + sumTravel + sumRent + sumOther;

    const categories = [
      { name: 'Food & Dining', value: sumFood, color: '#f59e0b' },
      { name: 'Utilities', value: sumUtilities, color: '#2563eb' },
      { name: 'Travel', value: sumTravel, color: '#10b981' },
      { name: 'Rent', value: sumRent, color: '#ef4444' },
      { name: 'Others', value: sumOther, color: '#64748b' }
    ].filter(c => c.value > 0);

    return { categories, total };
  };

  const getSplitTotalText = () => {
    const { split_type, split_with, split_details, amount } = manualExpense;
    if (split_type === 'equal') return null;

    let sum = 0;
    split_with.forEach(id => {
      sum += parseFloat(split_details[id] || 0);
    });

    if (split_type === 'percentage') {
      const isOk = Math.abs(sum - 100) < 0.01;
      return (
        <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: isOk ? 'var(--color-success)' : 'var(--color-danger)' }}>
          <strong>Total:</strong> {sum}% / 100% {isOk ? '✅' : '❌'}
        </div>
      );
    }

    if (split_type === 'unequal') {
      const target = parseFloat(amount || 0);
      const isOk = Math.abs(sum - target) < 0.01;
      return (
        <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: isOk ? 'var(--color-success)' : 'var(--color-danger)' }}>
          <strong>Total Distributed:</strong> ₹{sum.toLocaleString()} / ₹{target.toLocaleString()} {isOk ? '✅' : '❌'}
        </div>
      );
    }

    if (split_type === 'share') {
      return (
        <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: sum > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
          <strong>Total Shares:</strong> {sum} {sum > 0 ? '✅' : '❌'}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="app-layout">
      {/* Sidebar Panel */}
      <aside className="sidebar">
        <div>
          {/* Fynix branding */}
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">F</div>
            <span>Fynix</span>
          </div>

          {/* Logged in User widget */}
          {loggedInUser && (
            <div className="sidebar-profile">
              <div className="sidebar-profile-avatar">
                {loggedInUser.name.charAt(0)}
              </div>
              <div className="sidebar-profile-info" style={{ flex: 1 }}>
                <span className="sidebar-profile-name">{loggedInUser.name}</span>
                <span className="sidebar-profile-role">Personal Account</span>
              </div>
              <button onClick={handleLogout} className="btn-logout" title="Log Out">
                🚪
              </button>
            </div>
          )}

          <div className="sidebar-section-title">Main Menu</div>
          <div className="sidebar-menu">
            <button className={`sidebar-menu-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
              🏠 Dashboard
            </button>
            <button className={`sidebar-menu-item ${activeTab === 'ledger' ? 'active' : ''}`} onClick={() => setActiveTab('ledger')}>
              📑 Audit Ledger
            </button>
            <button className={`sidebar-menu-item ${activeTab === 'import' ? 'active' : ''}`} onClick={() => setActiveTab('import')}>
              📥 CSV Ingestion Wizard
            </button>
            <button className={`sidebar-menu-item ${activeTab === 'groups' ? 'active' : ''}`} onClick={() => setActiveTab('groups')}>
              👥 Group Timelines
            </button>
            <button className={`sidebar-menu-item ${activeTab === 'manual' ? 'active' : ''}`} onClick={() => setActiveTab('manual')}>
              💳 Log Expense / Pay
            </button>
          </div>
        </div>

      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        {/* Top Navbar */}
        <div className="top-navbar">
          <div className="top-navbar-title-section">
            <h1 className="top-navbar-title">
              {activeTab === 'dashboard' && 'Wallet'}
              {activeTab === 'ledger' && 'Audit Ledger'}
              {activeTab === 'import' && 'CSV Ingestion Wizard'}
              {activeTab === 'groups' && 'Group Timelines'}
              {activeTab === 'manual' && 'Log Expense / Pay'}
            </h1>
            <p className="top-navbar-subtitle">
              {activeTab === 'dashboard' && 'Securely store, track, and manage your money.'}
              {activeTab === 'ledger' && 'Track individual running balances and complete transaction history.'}
              {activeTab === 'import' && 'Review, resolve anomalies, and import expense records.'}
              {activeTab === 'groups' && 'Define active membership date ranges for flatmates.'}
              {activeTab === 'manual' && 'Record manual shared expenses or direct settlements.'}
            </p>
          </div>

          <div className="top-navbar-actions">
            {/* Search mockup removed */}

            {/* Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <select 
                className="form-select" 
                style={{ width: '160px', padding: '0.5rem', fontSize: '0.85rem', height: '38px', backgroundColor: '#ffffff' }}
                value={selectedGroupId || ''}
                onChange={(e) => setSelectedGroupId(parseInt(e.target.value, 10))}
              >
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>

            {/* Reset DB */}
            <button onClick={handleResetDatabase} className="btn btn-secondary" style={{ height: '38px', borderColor: 'var(--color-danger)', color: 'var(--color-danger)', fontSize: '0.85rem', fontWeight: 'bold' }}>
              Reset DB
            </button>

            {/* Settings & Help Icon shortcuts */}
            <div style={{ display: 'flex', gap: '0.45rem' }}>
              <button className="btn btn-secondary" style={{ width: '38px', height: '38px', padding: 0 }} title="Settings" onClick={() => setActiveTab('groups')}>⚙️</button>
              <button className="btn btn-secondary" style={{ width: '38px', height: '38px', padding: 0 }} title="Help Center" onClick={() => alert("Need help? Refer to instructions in README.md")}>❓</button>
            </div>
          </div>
        </div>

        {/* Tab Panels */}
        {/* 1. DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <>
            {/* Overview / Balance Details banner */}
            <div className="overview-banner">
              <div className="top-navbar-title-section">
                <span className="overview-balance-label">Overview / Balance Details</span>
                <div className="overview-balance-value" style={{ color: (balances[loggedInUser?.name] || 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {(balances[loggedInUser?.name] || 0) >= 0 ? '+' : '-'}₹{Math.abs(balances[loggedInUser?.name] || 0).toLocaleString()} INR
                </div>
                <div className="overview-balance-sub">
                  Your total balance estimate in {currentGroup?.name || 'Group'} at {new Date().toISOString().split('T')[0]} 12:20
                </div>
              </div>
              <button className="btn btn-primary" style={{ background: '#5bc85c', color: '#fff', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '10px', fontWeight: 'bold' }} onClick={() => setActiveTab('manual')}>
                🟢 Manage Balance
              </button>
            </div>

            <div className="dashboard-grid">
              {/* Column 1 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* Dynamic Group Member Cards */}
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '750', margin: 0 }}>{currentGroup?.name || 'Your Cards'}</h3>
                    <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', minWidth: 'auto' }} onClick={() => setActiveTab('groups')}>+</button>
                  </div>
                  <div className="cards-container">
                    {currentGroup?.members?.map((m, idx) => {
                      const val = balances[m.name] || 0;
                      const cardType = idx % 3 === 0 ? 'bank-card-personal' : idx % 3 === 1 ? 'bank-card-business' : 'bank-card-business-2';
                      return (
                        <div key={m.id} className={`bank-card ${cardType} ${auditUser === m.name ? 'active' : ''}`} onClick={() => { setAuditUser(m.name); setActiveTab('ledger'); }}>
                          <div className="bank-card-header">
                            <div className="bank-card-logo">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 22h20L12 2z"/></svg>
                              <span>{m.name}</span>
                            </div>
                            <div className="bank-card-chip"></div>
                          </div>
                          <div className="bank-card-number">
                            •••• •••• •••• {String(m.user_id).padStart(4, '0')}
                          </div>
                          <div className="bank-card-footer">
                            <span className="bank-card-name">{m.name === loggedInUser?.name ? 'Personal Account' : 'Group Member'}</span>
                            <span className="bank-card-balance">
                              {val >= 0 ? '+' : '-'}₹{Math.abs(val).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Spending Limits progress tracker */}
                  <div className="spending-limits">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-secondary)' }}>
                      <span>Spending Limits</span>
                      <span>{Math.round((ledger.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.totalAmount, 0) / 50000) * 100)}%</span>
                    </div>
                    <div className="limit-progress-bar">
                      <div className="limit-progress-fill" style={{ width: `${Math.min(100, (ledger.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.totalAmount, 0) / 50000) * 100)}%` }}></div>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      ₹{ledger.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.totalAmount, 0).toLocaleString()} spent of ₹50,000.00
                    </div>
                  </div>
                </div>
              </div>

              {/* Column 2 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* Recent Transactions list */}
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '750', margin: 0 }}>Transactions</h3>
                    <select className="form-select" style={{ width: '110px', padding: '0.25rem', fontSize: '0.75rem', height: 'auto', border: 'none', background: 'transparent', fontWeight: 'bold' }} disabled>
                      <option>This Month</option>
                    </select>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {ledger.slice(-5).reverse().map((entry, idx) => {
                      const isExpense = entry.type === 'expense';
                      const category = getCategory(entry.description);
                      const icon = getCategoryIcon(category);
                      return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '12px', background: '#f8fafc' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', border: '1px solid var(--border-color)' }}>
                              {icon}
                            </div>
                            <div>
                              <div style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{entry.description}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{category} • txn_{entry.id.split('-')[1]}</div>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: '800', fontSize: '0.85rem', color: entry.netChange >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                              {entry.netChange >= 0 ? '+' : '-'}₹{Math.abs(entry.netChange).toLocaleString()}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{entry.date}</div>
                          </div>
                        </div>
                      );
                    })}
                    {ledger.length === 0 && (
                      <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No transactions recorded.</div>
                    )}
                  </div>
                </div>

                {/* All Expenses Category Breakdown */}
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '750', margin: 0 }}>All Expenses</h3>
                    <select className="form-select" style={{ width: '110px', padding: '0.25rem', fontSize: '0.75rem', height: 'auto', border: 'none', background: 'transparent', fontWeight: 'bold' }} disabled>
                      <option>This Month</option>
                    </select>
                  </div>

                  {(() => {
                    const data = drawDoughnutChart();
                    if (data.total === 0) {
                      return (
                        <div style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          No expense records to analyze.
                        </div>
                      );
                    }
                    const radius = 35;
                    const circumference = 2 * Math.PI * radius;
                    let currentOffset = 0;
                    return (
                      <div className="doughnut-container">
                        <div className="doughnut-svg-wrapper">
                          <svg width="100%" height="100%" viewBox="0 0 120 120">
                            {data.categories.map((c, idx) => {
                              const pct = c.value / data.total;
                              const dash = pct * circumference;
                              const offset = currentOffset;
                              currentOffset += dash;
                              return (
                                <circle 
                                  key={idx}
                                  cx="60" 
                                  cy="60" 
                                  r={radius} 
                                  fill="transparent" 
                                  stroke={c.color} 
                                  strokeWidth="10" 
                                  strokeDasharray={`${dash} ${circumference - dash}`} 
                                  strokeDashoffset={-offset} 
                                  transform="rotate(-90 60 60)" 
                                />
                              );
                            })}
                          </svg>
                          <div className="doughnut-text-center">
                            <div className="doughnut-text-label">Platform</div>
                            <div className="doughnut-text-val">₹{Math.round(data.total).toLocaleString()}</div>
                          </div>
                        </div>

                        <div className="doughnut-legend">
                          {data.categories.map((c, idx) => (
                            <div key={idx} className="legend-item">
                              <div className="legend-left">
                                <div className="legend-color" style={{ backgroundColor: c.color }}></div>
                                <span style={{ fontSize: '0.75rem', fontWeight: '700' }}>{c.name}</span>
                              </div>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>
                                {Math.round((c.value / data.total) * 100)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Debt Settlement Minimization List */}
                <div className="card">
                  <h3 className="section-title">Debt Settlement Minimization</h3>
                  {payments.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>🎉</div>
                      <p>All group balances are perfectly settled!</p>
                    </div>
                  ) : (
                    <div className="settlement-list" style={{ gap: '0.5rem' }}>
                      {payments.map((p, idx) => (
                        <div key={idx} className="settlement-item" style={{ padding: '0.75rem 1rem', borderRadius: '10px' }}>
                          <div className="settlement-payer-payee" style={{ fontSize: '0.85rem' }}>
                            <span style={{ color: 'var(--color-danger)' }}>{p.from}</span>
                            <span className="settlement-arrow" style={{ fontSize: '1rem' }}>➔</span>
                            <span style={{ color: 'var(--color-success)' }}>{p.to}</span>
                          </div>
                          <div className="settlement-amount" style={{ fontSize: '1rem' }}>₹{p.amount.toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quick Settle Converter Widget */}
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '750', margin: 0 }}>Convert & Pay</h3>
                    <button className="btn btn-secondary" style={{ padding: 0, minWidth: 'auto', border: 'none', background: 'transparent' }}>⚙️</button>
                  </div>
                  
                  <form onSubmit={handleQuickSettleSubmit}>
                    <div className="convert-box">
                      <div className="convert-row">
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase' }}>You Pay</span>
                          <input 
                            type="number" 
                            step="0.01" 
                            className="convert-input" 
                            placeholder="0.00" 
                            value={quickSettleAmount}
                            onChange={(e) => setQuickSettleAmount(e.target.value)}
                            required
                          />
                        </div>
                        <span style={{ fontWeight: '800', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>INR (₹)</span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'center', margin: '-0.35rem 0' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1px solid var(--border-color)', backgroundColor: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.85rem' }}>⇅</div>
                      </div>

                      <div className="convert-row">
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase' }}>They Get</span>
                          <span style={{ fontSize: '1rem', fontWeight: '800', padding: '0.2rem 0', color: 'var(--text-primary)' }}>
                            ₹{quickSettleAmount ? parseFloat(quickSettleAmount).toLocaleString() : '0.00'}
                          </span>
                        </div>
                        <select 
                          className="convert-select"
                          value={quickSettlePayeeId}
                          onChange={(e) => setQuickSettlePayeeId(e.target.value)}
                          required
                        >
                          <option value="">Select payee</option>
                          {currentGroup?.members?.filter(m => m.user_id !== loggedInUser?.id).map(m => (
                            <option key={m.id} value={m.user_id}>{m.name}</option>
                          ))}
                        </select>
                      </div>

                      {quickSettlePayeeId && (() => {
                        const payeeObj = currentGroup?.members?.find(m => String(m.user_id) === quickSettlePayeeId);
                        const owedAmt = payments.find(p => p.from === loggedInUser?.name && p.to === payeeObj?.name)?.amount || 0;
                        return (
                          <div className="convert-details">
                            <div className="convert-details-row">
                              <span>Total Outstanding Debt to them</span>
                              <strong>₹{owedAmt.toLocaleString()}</strong>
                            </div>
                            <div className="convert-details-row">
                              <span>Transaction Fee</span>
                              <span style={{ color: 'var(--color-success)', fontWeight: '700' }}>Free (₹0.00)</span>
                            </div>
                          </div>
                        );
                      })()}

                      <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', background: '#5bc85c', border: 'none', color: '#fff', fontWeight: '800', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                        Continue Settlement
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </>
        )}

        {/* 2. LEDGER TAB */}
        {activeTab === 'ledger' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: '750' }}>Individual Balance Ledger</h2>
              </div>

              {/* Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <label className="form-label" style={{ margin: 0 }}>Select Member:</label>
                <select 
                  className="form-select"
                  value={auditUser}
                  onChange={(e) => setAuditUser(e.target.value)}
                  style={{ width: '180px', backgroundColor: '#ffffff' }}
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
                          <div style={{ fontWeight: '600' }}>{entry.description}</div>
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
                        <td style={{ fontWeight: '700' }} className={entry.runningBalance > 0 ? 'ledger-change-pos' : entry.runningBalance < 0 ? 'ledger-change-neg' : ''}>
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
            <h2 style={{ fontSize: '1.25rem', fontWeight: '750', marginBottom: '0.5rem' }}>CSV Ingestion Wizard</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
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
                      style={{ width: '80px', padding: '0.35rem', borderRadius: '8px' }}
                      value={usdRate}
                      onChange={(e) => setUsdRate(parseFloat(e.target.value) || 1.0)}
                    />
                  </div>
                </div>

                <h3 style={{ fontSize: '1.1rem', fontWeight: '750', marginBottom: '0.5rem' }}>Detected Data Anomalies ({parsedCSV.records.reduce((acc, r) => acc + r.anomalies.length, 0) + parsedCSV.duplicates.length} total)</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                  Please confirm policies and select resolutions where required.
                </p>

                {/* Render Duplicate Groups */}
                {parsedCSV.duplicates.length > 0 && (
                  <div style={{ marginBottom: '2rem' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '750', marginBottom: '0.5rem' }}>Duplicate & Conflict Resolution</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                      We detected overlapping events on the same day. Please select which records to retain.
                    </p>
                    <div className="anomaly-list" style={{ marginBottom: 0 }}>
                      {parsedCSV.duplicates.map((dup) => {
                        const key = `${dup.indexA}_${dup.indexB}`;
                        return (
                          <div key={`dup-${key}`} className="anomaly-card has-error">
                            <div className="anomaly-meta">
                              <span className="anomaly-title">Duplicate / Conflict Entry Conflict</span>
                              <span className="badge badge-danger">High Severity</span>
                            </div>
                            <p className="anomaly-details">{dup.description}</p>
                            
                            <div className="resolution-box">
                              <span className="form-label" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Resolution Action:</span>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                                  <input 
                                    type="radio" 
                                    name={`dup-choice-${key}`}
                                    checked={selectedDuplicates[key] === 'keepA'}
                                    onChange={() => setSelectedDuplicates(prev => ({ ...prev, [key]: 'keepA' }))}
                                  />
                                  <span>Keep Row {dup.rowA.rowNum} ("{dup.rowA.description}") and discard Row {dup.rowB.rowNum}</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                                  <input 
                                    type="radio" 
                                    name={`dup-choice-${key}`}
                                    checked={selectedDuplicates[key] === 'keepB'}
                                    onChange={() => setSelectedDuplicates(prev => ({ ...prev, [key]: 'keepB' }))}
                                  />
                                  <span>Keep Row {dup.rowB.rowNum} ("{dup.rowB.description}") and discard Row {dup.rowA.rowNum}</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                                  <input 
                                    type="radio" 
                                    name={`dup-choice-${key}`}
                                    checked={selectedDuplicates[key] === 'keepBoth'}
                                    onChange={() => setSelectedDuplicates(prev => ({ ...prev, [key]: 'keepBoth' }))}
                                  />
                                  <span>Keep both records as separate, distinct transactions</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
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
                    </div>
                  </div>
                )}

                <h3 style={{ fontSize: '1.1rem', fontWeight: '750', marginBottom: '0.5rem' }}>CSV Rows & Target Group Destinations</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                  Review each expense destination group (auto-classified based on date/members) and resolve anomalies.
                </p>

                <div className="ledger-table-container" style={{ maxHeight: '500px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.5rem', marginBottom: '1.5rem', backgroundColor: '#ffffff' }}>
                  <table className="ledger-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '60px' }}>Row</th>
                        <th style={{ width: '100px' }}>Date</th>
                        <th>Description</th>
                        <th style={{ width: '120px' }}>Amount</th>
                        <th style={{ width: '120px' }}>Payer</th>
                        <th style={{ width: '200px' }}>Target Group Destination</th>
                        <th style={{ width: '100px' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedCSV.records.map((row) => {
                        const skip = rowsToSkip.has(row.rowNum);
                        const rowAnomalies = row.anomalies || [];
                        const hasHigh = rowAnomalies.some(a => a.severity === 'HIGH');
                        const hasMedium = rowAnomalies.some(a => a.severity === 'MEDIUM');
                        const statusText = skip ? 'Skipped' : rowAnomalies.length > 0 ? `${rowAnomalies.length} Anom` : 'Clear';
                        const statusBadge = skip 
                          ? 'badge-secondary' 
                          : rowAnomalies.length > 0 
                            ? (hasHigh ? 'badge-danger' : 'badge-warning') 
                            : 'badge-success';

                        return (
                          <React.Fragment key={row.rowNum}>
                            <tr style={{ opacity: skip ? 0.4 : 1, transition: 'opacity 0.2s' }}>
                              <td style={{ fontWeight: '700', color: 'var(--color-primary)' }}>#{row.rowNum}</td>
                              <td style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{row.date || row.dateRaw}</td>
                              <td>
                                <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{row.description}</div>
                                {row.notes && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{row.notes}</div>}
                              </td>
                              <td>
                                {row.currency !== 'INR' && (
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>
                                    ({row.amountRaw} {row.currencyRaw})
                                  </span>
                                )}
                                ₹{row.amount}
                              </td>
                              <td>
                                <span style={{ color: rowAnomalies.some(a => a.type === 'PAYER_MISSING') ? 'var(--color-danger)' : 'var(--text-primary)', fontWeight: '600' }}>
                                  {row.paidByNormalized || row.paidByRaw || '(Missing)'}
                                </span>
                              </td>
                              <td>
                                <select
                                  className="form-select"
                                  style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', backgroundColor: '#ffffff', borderRadius: '8px' }}
                                  value={resolutions[row.rowNum]?.groupDecision || ''}
                                  onChange={(e) => updateResolution(row.rowNum, 'groupDecision', parseInt(e.target.value, 10))}
                                  disabled={skip}
                                >
                                  {groups.map(g => (
                                    <option key={g.id} value={g.id}>{g.name}</option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <span className={`badge ${statusBadge}`} style={{ fontSize: '0.7rem' }}>{statusText}</span>
                              </td>
                            </tr>
                            
                            {/* Render Inline Anomalies if any */}
                            {!skip && rowAnomalies.length > 0 && (
                              <tr>
                                <td colSpan="7" style={{ padding: '0.5rem 1rem 1rem 1rem', background: '#f8fafc' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', borderLeft: '2.5px solid var(--color-primary)', paddingLeft: '1rem', margin: '0.25rem 0 0.5rem 0' }}>
                                    {rowAnomalies.map((anom, aIdx) => {
                                      const isHigh = anom.severity === 'HIGH';
                                      const colorClass = isHigh ? 'var(--color-danger)' : anom.severity === 'MEDIUM' ? 'var(--color-warning)' : 'var(--color-primary)';
                                      return (
                                        <div key={aIdx} style={{ fontSize: '0.85rem' }}>
                                          <div style={{ fontWeight: '700', color: colorClass }}>
                                            ⚠️ [{anom.severity}] {anom.type}: {anom.message}
                                          </div>
                                          
                                          {/* Resolve options inline */}
                                          <div style={{ marginTop: '0.25rem' }}>
                                            {anom.type === 'PAYER_MISSING' && (
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                                                <span className="form-label" style={{ margin: 0, fontSize: '0.8rem' }}>Choose Payer:</span>
                                                <select 
                                                  className="form-select"
                                                  style={{ width: '150px', padding: '0.25rem', fontSize: '0.8rem', backgroundColor: '#ffffff', borderRadius: '6px' }}
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

                                            {anom.type === 'DATE_AMBIGUOUS' && (() => {
                                              const [yyyy, mm, dd] = row.date.split('-');
                                              const altDate = `${yyyy}-${dd}-${mm}`;
                                              return (
                                                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
                                                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>
                                                    <input 
                                                      type="radio" 
                                                      name={`date-choice-${row.rowNum}`}
                                                      checked={resolutions[row.rowNum]?.dateDecision === 'DD-MM-YYYY'}
                                                      onChange={() => updateResolution(row.rowNum, 'dateDecision', 'DD-MM-YYYY')}
                                                    />
                                                    <span>{formatDatePretty(row.date)} (DD-MM-YYYY)</span>
                                                  </label>
                                                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>
                                                    <input 
                                                      type="radio" 
                                                      name={`date-choice-${row.rowNum}`}
                                                      checked={resolutions[row.rowNum]?.dateDecision === 'MM-DD-YYYY'}
                                                      onChange={() => updateResolution(row.rowNum, 'dateDecision', 'MM-DD-YYYY')}
                                                    />
                                                    <span>{formatDatePretty(altDate)} (MM-DD-YYYY)</span>
                                                  </label>
                                                </div>
                                              );
                                            })()}

                                            {anom.type === 'PERCENTAGE_SUM_ERROR' && (
                                              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>
                                                  <input 
                                                    type="radio" 
                                                    name={`pct-choice-${row.rowNum}`}
                                                    checked={resolutions[row.rowNum]?.percentageDecision === 'normalize'}
                                                    onChange={() => updateResolution(row.rowNum, 'percentageDecision', 'normalize')}
                                                  />
                                                  <span>Auto-Normalize percentages to sum to 100% (Weighted)</span>
                                                </label>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>
                                                  <input 
                                                    type="radio" 
                                                    name={`pct-choice-${row.rowNum}`}
                                                    checked={resolutions[row.rowNum]?.percentageDecision === 'as_is'}
                                                    onChange={() => updateResolution(row.rowNum, 'percentageDecision', 'as_is')}
                                                  />
                                                  <span style={{ color: 'var(--color-danger)' }}>Import as-is</span>
                                                </label>
                                              </div>
                                            )}

                                            {anom.type === 'MEMBERSHIP_OUT_OF_BOUNDS' && (
                                              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>
                                                  <input 
                                                    type="radio" 
                                                    name={`mem-choice-${row.rowNum}-${anom.user}`}
                                                    checked={resolutions[row.rowNum]?.membershipDecision === 'remove'}
                                                    onChange={() => updateResolution(row.rowNum, 'membershipDecision', 'remove')}
                                                  />
                                                  <span>Remove {anom.user} from split</span>
                                                </label>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>
                                                  <input 
                                                    type="radio" 
                                                    name={`mem-choice-${row.rowNum}-${anom.user}`}
                                                    checked={resolutions[row.rowNum]?.membershipDecision === 'keep'}
                                                    onChange={() => updateResolution(row.rowNum, 'membershipDecision', 'keep')}
                                                  />
                                                  <span>Keep {anom.user} in split</span>
                                                </label>
                                              </div>
                                            )}

                                            {anom.type === 'EXTERNAL_MEMBER_INCLUDED' && (
                                              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>
                                                  <input 
                                                    type="radio" 
                                                    name={`ext-choice-${row.rowNum}-${anom.user}`}
                                                    checked={resolutions[row.rowNum]?.externalDecision === 'add_kabir'}
                                                    onChange={() => updateResolution(row.rowNum, 'externalDecision', 'add_kabir')}
                                                  />
                                                  <span>Add Kabir as a temporary member</span>
                                                </label>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>
                                                  <input 
                                                    type="radio" 
                                                    name={`ext-choice-${row.rowNum}-${anom.user}`}
                                                    checked={resolutions[row.rowNum]?.externalDecision === 'assign_dev'}
                                                    onChange={() => updateResolution(row.rowNum, 'externalDecision', 'assign_dev')}
                                                  />
                                                  <span>Assign Kabir's share to Dev</span>
                                                </label>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
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
                <div style={{ textAlign: 'center', padding: '2rem', background: '#eefdf4', borderRadius: '12px', border: '1px solid #bbf7d0', marginBottom: '2rem' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>✅</div>
                  <h3 style={{ color: 'var(--color-success)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>Import Succeeded!</h3>
                  <p>{importReport.message}</p>
                </div>

                <h3>Ingestion Report (Anomaly Resolution Log)</h3>
                <div style={{ background: '#0f172a', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem', maxHeight: '300px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.85rem', color: '#cbd5e1', marginTop: '0.75rem', lineHeight: '1.6' }}>
                  {importReport.anomalies.map((line, idx) => (
                    <div key={idx} style={{ marginBottom: '0.4rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem' }}>{line}</div>
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
              <h2 style={{ fontSize: '1.25rem', fontWeight: '750' }}>Group Membership Timelines</h2>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                Define active membership date ranges for flatmates to ensure expenses are split correctly over time.
              </p>

              {groups.map(g => (
                <div key={g.id} style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.25rem', background: selectedGroupId === g.id ? '#f0fdf4' : 'transparent', borderColor: selectedGroupId === g.id ? '#bbf7d0' : 'var(--border-color)' }}>
                  <h4 style={{ fontSize: '1.05rem', marginBottom: '0.5rem', fontWeight: '700' }}>{g.name}</h4>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>{g.description}</p>
                  
                  <h5 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Members & Dates:</h5>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {g.members.map(m => (
                      <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', background: '#ffffff', padding: '0.5rem 0.75rem', borderRadius: '8px', fontSize: '0.9rem', border: '1px solid var(--border-color)' }}>
                        <span style={{ fontWeight: '600' }}>{m.name}</span>
                        <span style={{ color: 'var(--color-primary)', fontWeight: '700' }}>
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
              <h2 style={{ fontSize: '1.25rem', fontWeight: '750' }}>Create New Group</h2>
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
                        <div key={user.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
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
                          <span style={{ width: '80px', fontWeight: '600', fontSize: '0.9rem' }}>{user.name}</span>
                          
                          {isChecked && (
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1 }}>
                              <input 
                                type="date" 
                                className="form-input"
                                style={{ padding: '0.25rem', fontSize: '0.8rem', borderRadius: '6px' }}
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
                                style={{ padding: '0.25rem', fontSize: '0.8rem', borderRadius: '6px' }}
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

                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem', padding: '0.75rem', borderRadius: '10px' }}>
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
              <h2 style={{ fontSize: '1.25rem', fontWeight: '750' }}>Log Shared Expense</h2>
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
                      style={{ backgroundColor: '#ffffff' }}
                    >
                      <option value="INR">INR (₹)</option>
                      <option value="USD">USD ($)</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Paid By</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={loggedInUser?.name || ''} 
                      disabled 
                      style={{ background: '#f8fafc', cursor: 'not-allowed', color: 'var(--text-secondary)', fontWeight: '600' }}
                    />
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
                    style={{ backgroundColor: '#ffffff' }}
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
                          <span style={{ width: '80px', fontWeight: '600', fontSize: '0.9rem' }}>{m.name}</span>
                          
                          {isChecked && manualExpense.split_type !== 'equal' && (
                            <input 
                              type="number"
                              className="form-input"
                              style={{ width: '120px', padding: '0.25rem 0.5rem', borderRadius: '8px' }}
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
                  {getSplitTotalText()}
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

                <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.75rem', borderRadius: '10px' }}>
                  Add Shared Expense
                </button>
              </form>
            </div>

            {/* Form 2: Record Settlement */}
            <div className="card">
              <h2 style={{ fontSize: '1.25rem', fontWeight: '750' }}>Record Payment / Settlement</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                Log peer-to-peer cash payments made to settle outstanding debts directly.
              </p>

              <form onSubmit={handleAddSettlement}>
                <div className="form-group">
                  <label className="form-label">From (Payer)</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={loggedInUser?.name || ''} 
                    disabled 
                    style={{ background: '#f8fafc', cursor: 'not-allowed', color: 'var(--text-secondary)', fontWeight: '600' }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">To (Payee)</label>
                  <select 
                    className="form-select"
                    value={manualSettlement.payee_id}
                    onChange={(e) => setManualSettlement(prev => ({ ...prev, payee_id: e.target.value }))}
                    required
                    style={{ backgroundColor: '#ffffff' }}
                  >
                    <option value="">-- Select Creditor --</option>
                    {currentGroup?.members?.filter(m => m.user_id !== loggedInUser?.id).map(m => (
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
                      style={{ backgroundColor: '#ffffff' }}
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

                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem', padding: '0.75rem', borderRadius: '10px' }}>
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
