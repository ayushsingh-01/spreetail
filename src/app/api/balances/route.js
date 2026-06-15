import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Greedy Debt Minimization Algorithm
function minimizeDebts(balancesMap) {
  const members = Object.keys(balancesMap).map(name => ({
    name,
    balance: Math.round(balancesMap[name] * 100) / 100
  }));

  const debtors = members.filter(m => m.balance < -0.01).sort((a, b) => a.balance - b.balance);
  const creditors = members.filter(m => m.balance > 0.01).sort((a, b) => b.balance - a.balance);

  const payments = [];

  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];

    const debtAmount = Math.abs(debtor.balance);
    const creditAmount = creditor.balance;

    const payment = Math.round(Math.min(debtAmount, creditAmount) * 100) / 100;

    if (payment > 0) {
      payments.push({
        from: debtor.name,
        to: creditor.name,
        amount: payment
      });

      debtor.balance += payment;
      creditor.balance -= payment;
    }

    if (Math.abs(debtor.balance) < 0.01) {
      dIdx++;
    }
    if (creditor.balance < 0.01) {
      cIdx++;
    }
  }

  return payments;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const groupIdStr = searchParams.get('groupId');
    const auditUserName = searchParams.get('auditUser');

    if (!groupIdStr) {
      return NextResponse.json({ error: 'groupId is required' }, { status: 400 });
    }

    const groupId = parseInt(groupIdStr, 10);
    const db = getDb();
    await db.initPromise;

    // 1. Get all group members
    const memberships = await db.prepare(`
      SELECT u.id as user_id, u.name 
      FROM group_memberships m
      JOIN users u ON m.user_id = u.id
      WHERE m.group_id = ?
    `).all(groupId);

    if (memberships.length === 0) {
      return NextResponse.json({ balances: {}, payments: [], ledger: [], groupTransactions: [] });
    }

    const memberNames = memberships.map(m => m.name);

    const balances = {};
    memberNames.forEach(name => {
      balances[name] = 0;
    });

    // 2. Fetch all expenses in the group
    const expenses = await db.prepare(`
      SELECT e.id, e.description, e.amount, e.currency, e.converted_amount_inr, 
             e.paid_by_user_id, u.name as paid_by_name, e.split_type, e.expense_date, e.notes
      FROM expenses e
      JOIN users u ON e.paid_by_user_id = u.id
      WHERE e.group_id = ?
      ORDER BY e.expense_date ASC, e.id ASC
    `).all(groupId);

    // Fetch splits for these expenses
    const expenseIds = expenses.map(e => e.id);
    let splits = [];
    if (expenseIds.length > 0) {
      const placeholders = expenseIds.map(() => '?').join(',');
      splits = await db.prepare(`
        SELECT s.expense_id, s.user_id, u.name as user_name, s.calculated_amount_inr
        FROM expense_splits s
        JOIN users u ON s.user_id = u.id
        WHERE s.expense_id IN (${placeholders})
      `).all(...expenseIds);
    }

    // Map splits to expenses
    const splitsByExpense = {};
    splits.forEach(s => {
      if (!splitsByExpense[s.expense_id]) {
        splitsByExpense[s.expense_id] = [];
      }
      splitsByExpense[s.expense_id].push(s);
    });

    // Apply expenses to balances
    expenses.forEach(e => {
      const payerName = e.paid_by_name;
      
      if (balances[payerName] !== undefined) {
        balances[payerName] += e.converted_amount_inr;
      }

      const expenseSplits = splitsByExpense[e.id] || [];
      expenseSplits.forEach(s => {
        if (balances[s.user_name] !== undefined) {
          balances[s.user_name] -= s.calculated_amount_inr;
        }
      });
    });

    // 3. Fetch all settlements in the group
    const settlements = await db.prepare(`
      SELECT s.id, s.amount, s.currency, s.converted_amount_inr, 
             s.payer_id, u1.name as payer_name, 
             s.payee_id, u2.name as payee_name, 
             s.settlement_date, s.notes
      FROM settlements s
      JOIN users u1 ON s.payer_id = u1.id
      JOIN users u2 ON s.payee_id = u2.id
      WHERE s.group_id = ?
      ORDER BY s.settlement_date ASC, s.id ASC
    `).all(groupId);

    // Apply settlements to balances
    settlements.forEach(s => {
      const payerName = s.payer_name;
      const payeeName = s.payee_name;

      if (balances[payerName] !== undefined) {
        balances[payerName] += s.converted_amount_inr;
      }
      if (balances[payeeName] !== undefined) {
        balances[payeeName] -= s.converted_amount_inr;
      }
    });

    // Calculate minimized debts
    const payments = minimizeDebts({ ...balances });

    // 4. Generate audit ledger if a specific user is requested
    let ledger = [];
    if (auditUserName && balances[auditUserName] !== undefined) {
      // Collect all expenses user participated in
      const userExpenses = expenses.filter(e => {
        const isPayer = e.paid_by_name === auditUserName;
        const inSplit = (splitsByExpense[e.id] || []).some(s => s.user_name === auditUserName);
        return isPayer || inSplit;
      });

      // Format expense ledger entries
      const expenseEntries = userExpenses.map(e => {
        const isPayer = e.paid_by_name === auditUserName;
        const mySplit = (splitsByExpense[e.id] || []).find(s => s.user_name === auditUserName);
        const myShare = mySplit ? mySplit.calculated_amount_inr : 0;
        const amountPaid = isPayer ? e.converted_amount_inr : 0;
        const netChange = amountPaid - myShare;

        return {
          id: `expense-${e.id}`,
          date: e.expense_date,
          description: e.description,
          type: 'expense',
          totalAmount: e.converted_amount_inr,
          currency: e.currency,
          originalAmount: e.amount,
          paidBy: e.paid_by_name,
          myShare,
          netChange,
          notes: e.notes || ''
        };
      });

      // Collect settlements user was involved in
      const userSettlements = settlements.filter(s => {
        return s.payer_name === auditUserName || s.payee_name === auditUserName;
      });

      // Format settlement entries
      const settlementEntries = userSettlements.map(s => {
        const isPayer = s.payer_name === auditUserName;
        const netChange = isPayer ? s.converted_amount_inr : -s.converted_amount_inr;

        return {
          id: `settlement-${s.id}`,
          date: s.settlement_date,
          description: isPayer 
            ? `Settlement: Paid ${s.payee_name}` 
            : `Settlement: Received from ${s.payer_name}`,
          type: 'settlement',
          totalAmount: s.converted_amount_inr,
          currency: s.currency,
          originalAmount: s.amount,
          paidBy: s.payer_name,
          myShare: 0,
          netChange,
          notes: s.notes || ''
        };
      });

      // Merge and sort ledger entries by date
      ledger = [...expenseEntries, ...settlementEntries].sort((a, b) => {
        if (a.date !== b.date) {
          return a.date.localeCompare(b.date);
        }
        return a.id.localeCompare(b.id);
      });

      // Calculate running balance
      let runningBalance = 0;
      ledger.forEach(entry => {
        runningBalance += entry.netChange;
        entry.runningBalance = Math.round(runningBalance * 100) / 100;
      });
    }

    // 5. Generate group-wide transactions list for the dashboard
    const expenseTxns = expenses.map(e => ({
      id: `expense-${e.id}`,
      date: e.expense_date,
      description: e.description,
      type: 'expense',
      totalAmount: e.converted_amount_inr,
      currency: e.currency,
      originalAmount: e.amount,
      paidBy: e.paid_by_name,
      notes: e.notes || ''
    }));

    const settlementTxns = settlements.map(s => ({
      id: `settlement-${s.id}`,
      date: s.settlement_date,
      description: `Payment: ${s.payer_name} paid ${s.payee_name}`,
      type: 'settlement',
      totalAmount: s.converted_amount_inr,
      currency: s.currency,
      originalAmount: s.amount,
      paidBy: s.payer_name,
      notes: s.notes || ''
    }));

    const groupTransactions = [...expenseTxns, ...settlementTxns].sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date);
      }
      return a.id.localeCompare(b.id);
    });

    return NextResponse.json({
      balances,
      payments,
      ledger,
      groupTransactions
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
