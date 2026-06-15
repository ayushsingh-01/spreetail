import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(request) {
  try {
    const body = await request.json();
    const { 
      group_id, 
      payer_id, 
      payee_id, 
      amount, 
      currency, 
      converted_amount_inr, 
      settlement_date, 
      notes 
    } = body;

    if (!group_id || !payer_id || !payee_id || !amount || !settlement_date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getDb();
    await db.initPromise;

    const stmt = db.prepare(`
      INSERT INTO settlements (group_id, payer_id, payee_id, amount, currency, 
                               converted_amount_inr, settlement_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const res = await stmt.run(
      group_id,
      payer_id,
      payee_id,
      amount,
      currency || 'INR',
      converted_amount_inr || amount,
      settlement_date,
      notes || ''
    );
    const settlementId = res.lastInsertRowid;

    return NextResponse.json({ success: true, settlementId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
