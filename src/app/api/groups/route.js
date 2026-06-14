import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    
    // Fetch groups
    const groups = db.prepare('SELECT * FROM groups').all();
    
    // For each group, fetch members and their membership timeline
    for (const group of groups) {
      const memberships = db.prepare(`
        SELECT m.id, m.joined_at, m.left_at, u.id as user_id, u.name, u.email
        FROM group_memberships m
        JOIN users u ON m.user_id = u.id
        WHERE m.group_id = ?
      `).all(group.id);
      group.members = memberships;
    }
    
    return NextResponse.json(groups);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, description, members } = body; // members is array of { user_id, joined_at, left_at }
    
    if (!name) {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
    }
    
    const db = getDb();
    
    // Perform transaction
    const createGroupTransaction = db.transaction(() => {
      const groupStmt = db.prepare('INSERT INTO groups (name, description) VALUES (?, ?)');
      const groupId = groupStmt.run(name, description || '').lastInsertRowid;
      
      if (members && Array.isArray(members)) {
        const memStmt = db.prepare(`
          INSERT INTO group_memberships (group_id, user_id, joined_at, left_at)
          VALUES (?, ?, ?, ?)
        `);
        for (const m of members) {
          memStmt.run(groupId, m.user_id, m.joined_at, m.left_at || null);
        }
      }
      return groupId;
    });
    
    const groupId = createGroupTransaction();
    
    return NextResponse.json({ success: true, groupId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
