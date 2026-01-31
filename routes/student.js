const express = require('express');
const router = express.Router();
const db = require('../database');

// Middleware
const isStudent = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'student') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Unauthorized' });
    }
};

router.use(isStudent);

// Get My Attendance
router.get('/my-attendance', (req, res) => {
    const studentId = req.session.user.student_id;

    try {
        const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
        const attendance = db.prepare('SELECT * FROM attendance WHERE student_id = ? ORDER BY date DESC').all(studentId);

        // Calculate Summary
        const summary = {
            total: attendance.length,
            present: attendance.filter(a => a.status === 'P').length,
            absent: attendance.filter(a => a.status === 'A').length,
            leave: attendance.filter(a => a.status === 'L').length
        };
        summary.percentage = summary.total > 0 ? ((summary.present / summary.total) * 100).toFixed(1) : 0;

        res.json({ success: true, student, attendance, summary });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
