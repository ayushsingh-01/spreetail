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
    
    // Parse records and detect initial anomalies
    const records = parseCSVData(csvText);
    
    // Find duplicates/conflicts
    const duplicates = detectDuplicates(records);

    // Get all users and groups in the system to help with manual resolutions
    const db = getDb();
    const dbUsers = db.prepare('SELECT id, name FROM users').all();
    const dbGroups = db.prepare('SELECT id, name FROM groups').all();

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
