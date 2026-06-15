import { NextResponse } from 'next/server';
import { parseCSVData, detectDuplicates } from '@/lib/parser';
import { getDb } from '@/lib/db';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const csvText = await file.text();
    
    // Get all users, groups and memberships in the system to dynamically adapt the parser
    const db = getDb();
    await db.initPromise;
    const dbUsers = await db.prepare('SELECT id, name FROM users').all();
    const dbGroups = await db.prepare('SELECT id, name FROM groups').all();
    const dbMemberships = await db.prepare(`
      SELECT m.group_id, u.name as user_name, m.joined_at, m.left_at
      FROM group_memberships m
      JOIN users u ON m.user_id = u.id
    `).all();

    // Parse records and detect initial anomalies with dynamic system state
    const records = parseCSVData(csvText, dbUsers, dbGroups, dbMemberships);
    
    // Find duplicates/conflicts
    const duplicates = detectDuplicates(records);

    return NextResponse.json({
      success: true,
      records,
      duplicates,
      systemUsers: dbUsers,
      systemGroups: dbGroups
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
