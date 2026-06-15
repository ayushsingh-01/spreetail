import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(request) {
  try {
    const body = await request.json();
    const { 
      group_id, 
      description, 
      amount, 
      currency, 
      converted_amount_inr, 
      paid_by_user_id, 
      split_type, 
      expense_date, 
      notes, 
      splits // array of { user_id, raw_split_value, calculated_amount_inr }
    } = body;

    if (!group_id || !description || !amount || !paid_by_user_id || !split_type || !expense_date || !splits) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getDb();
    await db.initPromise;

    const addExpenseTransaction = db.transaction(async () => {
      const expenseStmt = db.prepare(`
        INSERT INTO expenses (group_id, description, amount, currency, converted_amount_inr, 
                              paid_by_user_id, split_type, expense_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const splitStmt = db.prepare(`
        INSERT INTO expense_splits (expense_id, user_id, raw_split_value, calculated_amount_inr)
        VALUES (?, ?, ?, ?)
      `);

      const res = await expenseStmt.run(
        group_id,
        description,
        amount,
        currency || 'INR',
        converted_amount_inr || amount,
        paid_by_user_id,
        split_type,
        expense_date,
        notes || ''
      );
      const expenseId = res.lastInsertRowid;

      for (const sp of splits) {
        await splitStmt.run(
          expenseId,
          sp.user_id,
          sp.raw_split_value,
          sp.calculated_amount_inr
        );
      }

      return expenseId;
    });

    const expenseId = await addExpenseTransaction();

    return NextResponse.json({ success: true, expenseId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
