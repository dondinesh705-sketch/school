const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Unauthorized' });
    }
};

router.use(isAdmin);

// --- Student Management ---

// Get all students
router.get('/students', (req, res) => {
    const adminId = req.session.user.id;
    try {
        const students = db.prepare('SELECT * FROM students WHERE admin_id = ? ORDER BY roll_number').all(adminId);
        res.json({ success: true, students });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Add Student
router.post('/students', (req, res) => {
    const { name, roll_number } = req.body;
    const adminId = req.session.user.id;

    // Default password for students matches their roll number (simplified for this use case)
    const password = roll_number;

    try {
        const insertStudent = db.transaction(() => {
            // 1. Insert into students table with admin_id
            const info = db.prepare('INSERT INTO students (name, roll_number, admin_id) VALUES (?, ?, ?)').run(name, roll_number, adminId);
            const studentId = info.lastInsertRowid;

            // 2. Create User account
            const hash = bcrypt.hashSync(password, 10);
            db.prepare('INSERT INTO users (username, password, role, student_id) VALUES (?, ?, ?, ?)').run(roll_number, hash, 'student', studentId);

            return info;
        });

        insertStudent();
        res.json({ success: true, message: 'Student added successfully' });

    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(400).json({ success: false, message: 'Roll number already exists in your class' });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update Student
router.put('/students/:id', (req, res) => {
    const { name, roll_number } = req.body;
    const { id } = req.params;
    const adminId = req.session.user.id;

    try {
        // Ensure student belongs to this admin
        db.prepare('UPDATE students SET name = ?, roll_number = ? WHERE id = ? AND admin_id = ?').run(name, roll_number, id, adminId);
        // Also update username if roll_number changed
        db.prepare('UPDATE users SET username = ? WHERE student_id = ?').run(roll_number, id);

        res.json({ success: true, message: 'Student updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete Student
router.delete('/students/:id', (req, res) => {
    const { id } = req.params;
    const adminId = req.session.user.id;
    try {
        // Ensure student belongs to this admin
        db.prepare('DELETE FROM students WHERE id = ? AND admin_id = ?').run(id, adminId);
        res.json({ success: true, message: 'Student deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Search Students
router.get('/students/search', (req, res) => {
    const { term } = req.query;
    const adminId = req.session.user.id;
    try {
        const students = db.prepare('SELECT * FROM students WHERE admin_id = ? AND (name LIKE ? OR roll_number LIKE ?)').all(adminId, `%${term}%`, `%${term}%`);
        res.json({ success: true, students });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// --- Attendance Management ---

// Get Attendance Sheet for a Month
router.get('/attendance', (req, res) => {
    const { month, year } = req.query;
    const adminId = req.session.user.id;

    if (!month || !year) return res.status(400).json({ success: false, message: 'Month and Year required' });

    const startDate = `${year}-${month}-01`;
    const endDate = `${year}-${month}-31`;

    try {
        const students = db.prepare('SELECT * FROM students WHERE admin_id = ? ORDER BY roll_number').all(adminId);
        const studentIds = students.map(s => s.id);

        if (studentIds.length === 0) {
            return res.json({ success: true, students: [], attendance: {} });
        }

        const placeholders = studentIds.map(() => '?').join(',');
        const attendanceRecords = db.prepare(`
            SELECT student_id, date, status 
            FROM attendance 
            WHERE date BETWEEN ? AND ? AND student_id IN (${placeholders})
        `).all(startDate, endDate, ...studentIds);

        const attendanceMap = {};
        attendanceRecords.forEach(record => {
            if (!attendanceMap[record.student_id]) attendanceMap[record.student_id] = {};
            attendanceMap[record.student_id][record.date] = record.status;
        });

        res.json({ success: true, students, attendance: attendanceMap });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Save/Update Attendance
router.post('/attendance', (req, res) => {
    const { date, attendanceData } = req.body; // attendanceData: [{ student_id, status }, ...]

    try {
        const updateAttendance = db.transaction(() => {
            attendanceData.forEach(({ student_id, status }) => {
                // Upsert logic (Insert or Replace)
                db.prepare(`
                    INSERT INTO attendance (student_id, date, status) 
                    VALUES (?, ?, ?)
                    ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status
                `).run(student_id, date, status);
            });
        });

        updateAttendance();
        res.json({ success: true, message: 'Attendance saved' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
