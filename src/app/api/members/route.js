import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(request) {
  try {
    const body = await request.json();
    const { group_id, user_id, joined_at, left_at } = body;

    if (!group_id || !user_id || !joined_at) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getDb();
    await db.initPromise;

    // Check if membership already exists
    const existing = await db.prepare(`
      SELECT id FROM group_memberships 
      WHERE group_id = ? AND user_id = ?
    `).get(group_id, user_id);

    if (existing) {
      // Update
      await db.prepare(`
        UPDATE group_memberships 
        SET joined_at = ?, left_at = ?
        WHERE id = ?
      `).run(joined_at, left_at || null, existing.id);
    } else {
      // Insert new
      await db.prepare(`
        INSERT INTO group_memberships (group_id, user_id, joined_at, left_at)
        VALUES (?, ?, ?, ?)
      `).run(group_id, user_id, joined_at, left_at || null);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
