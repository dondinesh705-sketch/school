const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'attendance.db');
const db = new Database(dbPath, { verbose: console.log });

// Initialize tables
const initDb = () => {
    // Users table (for login)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT CHECK(role IN ('admin', 'student')) NOT NULL,
            student_id INTEGER,
            FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
        )
    `).run();

    // Students table migration check
    const tableInfo = db.prepare("PRAGMA table_info(students)").all();
    const hasAdminId = tableInfo.some(col => col.name === 'admin_id');

    if (tableInfo.length > 0 && !hasAdminId) {
        console.log('Notice: Migrating students table to add missing admin_id column...');
        try {
            db.transaction(() => {
                db.prepare('ALTER TABLE students RENAME TO students_old').run();
                db.prepare(`
                    CREATE TABLE students (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        roll_number TEXT NOT NULL,
                        admin_id INTEGER NOT NULL,
                        FOREIGN KEY(admin_id) REFERENCES users(id) ON DELETE CASCADE,
                        UNIQUE(roll_number, admin_id)
                    )
                `).run();
                db.prepare('INSERT INTO students (id, name, roll_number, admin_id) SELECT id, name, roll_number, 1 FROM students_old').run();
                db.prepare('DROP TABLE students_old').run();
            })();
            console.log('Success: Migration completed.');
        } catch (err) {
            console.error('Error: Migration failed:', err.message);
        }
    } else {
        // Standard creation if it doesn't exist
        db.prepare(`
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                roll_number TEXT NOT NULL,
                admin_id INTEGER NOT NULL,
                FOREIGN KEY(admin_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(roll_number, admin_id)
            )
        `).run();
    }

    // Attendance table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            date TEXT NOT NULL, -- YYYY-MM-DD
            status TEXT CHECK(status IN ('P', 'A', 'L')) NOT NULL,
            FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
            UNIQUE(student_id, date)
        )
    `).run();

    // Create default admin if not exists
    const adminCheck = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
    if (!adminCheck) {
        const hash = bcrypt.hashSync('admin123', 10);
        db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
        console.log('Default admin created: admin / admin123');
    }

    // Repair missing student accounts
    const studentsWithoutUsers = db.prepare(`
        SELECT * FROM students 
        WHERE id NOT IN (SELECT student_id FROM users WHERE student_id IS NOT NULL)
    `).all();

    if (studentsWithoutUsers.length > 0) {
        console.log(`Notice: Creating user accounts for ${studentsWithoutUsers.length} students...`);
        try {
            db.transaction(() => {
                const insertUser = db.prepare('INSERT INTO users (username, password, role, student_id) VALUES (?, ?, ?, ?)');
                for (const student of studentsWithoutUsers) {
                    // Check if username already exists to avoid conflict
                    const userExists = db.prepare('SELECT id FROM users WHERE username = ?').get(student.roll_number);
                    if (!userExists) {
                        const hash = bcrypt.hashSync(student.roll_number, 10);
                        insertUser.run(student.roll_number, hash, 'student', student.id);
                    }
                }
            })();
            console.log('Success: Student user accounts repaired.');
        } catch (err) {
            console.error('Error: Failed to repair student accounts:', err.message);
        }
    }
};

initDb();

module.exports = db;
