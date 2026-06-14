import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(request) {
  try {
    const body = await request.json();
    const { groupId, resolvedExpenses, resolvedSettlements } = body;

    if (!groupId) {
      return NextResponse.json({ error: 'Group ID is required' }, { status: 400 });
    }

    const db = getDb();

    // Use SQLite transaction to guarantee atomicity of the import
    const importTransaction = db.transaction(() => {
      // 1. Save resolved expenses
      const expenseStmt = db.prepare(`
        INSERT INTO expenses (group_id, description, amount, currency, converted_amount_inr, 
                              paid_by_user_id, split_type, expense_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const splitStmt = db.prepare(`
        INSERT INTO expense_splits (expense_id, user_id, raw_split_value, calculated_amount_inr)
        VALUES (?, ?, ?, ?)
      `);

      let expensesCount = 0;
      if (resolvedExpenses && Array.isArray(resolvedExpenses)) {
        for (const exp of resolvedExpenses) {
          const res = expenseStmt.run(
            groupId,
            exp.description,
            exp.amount,
            exp.currency,
            exp.converted_amount_inr,
            exp.paid_by_user_id,
            exp.split_type,
            exp.expense_date,
            exp.notes || ''
          );
          
          const expenseId = res.lastInsertRowid;

          // Insert splits
          for (const sp of exp.splits) {
            splitStmt.run(
              expenseId,
              sp.user_id,
              sp.raw_split_value,
              sp.calculated_amount_inr
            );
          }
          expensesCount++;
        }
      }

      // 2. Save resolved settlements
      const settlementStmt = db.prepare(`
        INSERT INTO settlements (group_id, payer_id, payee_id, amount, currency, 
                                 converted_amount_inr, settlement_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let settlementsCount = 0;
      if (resolvedSettlements && Array.isArray(resolvedSettlements)) {
        for (const set of resolvedSettlements) {
          settlementStmt.run(
            groupId,
            set.payer_id,
            set.payee_id,
            set.amount,
            set.currency,
            set.converted_amount_inr,
            set.settlement_date,
            set.notes || ''
          );
          settlementsCount++;
        }
      }

      return { expensesCount, settlementsCount };
    });

    const result = importTransaction();

    return NextResponse.json({
      success: true,
      message: `Successfully imported ${result.expensesCount} expenses and ${result.settlementsCount} settlements.`,
      ...result
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
