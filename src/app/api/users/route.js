import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    const users = db.prepare('SELECT id, name, email FROM users').all();
    return NextResponse.json(users);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, email } = body;
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    const db = getDb();
    
    // Check if user already exists
    const existing = db.prepare('SELECT * FROM users WHERE name = ?').get(name);
    if (existing) {
      return NextResponse.json(existing);
    }
    
    const res = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').run(name, email || '');
    const user = { id: res.lastInsertRowid, name, email };
    return NextResponse.json(user);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
