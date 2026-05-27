#!/usr/bin/env node

import Database from 'better-sqlite3';

const DB_PATH = '/root/claude-telegram-bot/data/sessions.db';

console.log('🔧 Migrating sessions database...');

const db = new Database(DB_PATH);

try {
  // Check if columns already exist
  const tableInfo = db.prepare("PRAGMA table_info(sessions)").all();
  const hasMessageCount = tableInfo.some(col => col.name === 'message_count');
  const hasSummary = tableInfo.some(col => col.name === 'summary');

  if (!hasMessageCount || !hasSummary) {
    console.log('Adding new columns...');

    if (!hasSummary) {
      db.exec('ALTER TABLE sessions ADD COLUMN summary TEXT');
      console.log('✅ Added summary column');
    }

    if (!hasMessageCount) {
      db.exec('ALTER TABLE sessions ADD COLUMN message_count INTEGER DEFAULT 0');
      console.log('✅ Added message_count column');
    }

    console.log('✅ Migration complete!');
  } else {
    console.log('✅ Database already up to date');
  }
} catch (error) {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
} finally {
  db.close();
}
