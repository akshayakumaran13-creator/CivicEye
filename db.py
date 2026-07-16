import sqlite3
import os
from datetime import datetime
import config

def get_db_connection():
    conn = sqlite3.connect(config.DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            category TEXT NOT NULL,
            severity TEXT NOT NULL,
            latitude TEXT,
            longitude TEXT,
            place_name TEXT,
            timestamp TEXT NOT NULL,
            language TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Active',
            flags_count INTEGER NOT NULL DEFAULT 1
        )
    """)
    existing = [row[1] for row in cursor.execute("PRAGMA table_info(reports)").fetchall()]
    if 'place_name' not in existing:
        cursor.execute("ALTER TABLE reports ADD COLUMN place_name TEXT")
    if 'status' not in existing:
        cursor.execute("ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'Active'")
    if 'flags_count' not in existing:
        cursor.execute("ALTER TABLE reports ADD COLUMN flags_count INTEGER NOT NULL DEFAULT 1")
    conn.commit()
    conn.close()

def add_report(filename, category, severity, latitude, longitude, place_name, language):
    conn = get_db_connection()
    cursor = conn.cursor()
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    cursor.execute(
        "INSERT INTO reports (filename, category, severity, latitude, longitude, place_name, timestamp, language, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active')",
        (filename, category, severity, latitude, longitude, place_name, timestamp, language)
    )
    conn.commit()
    report_id = cursor.lastrowid
    conn.close()
    return report_id

def get_all_reports(status_filter=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    if status_filter:
        cursor.execute("SELECT * FROM reports WHERE status=? ORDER BY id DESC", (status_filter,))
    else:
        cursor.execute("SELECT * FROM reports ORDER BY id DESC")
    rows = cursor.fetchall()
    reports = [dict(row) for row in rows]
    conn.close()
    return reports

def get_active_reports():
    return get_all_reports(status_filter='Active')

def update_report_status(report_id, new_status):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE reports SET status=? WHERE id=?", (new_status, report_id))
    conn.commit()
    conn.close()

def increment_report_flags(report_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE reports SET flags_count=flags_count+1 WHERE id=?", (report_id,))
    cursor.execute("SELECT flags_count FROM reports WHERE id=?", (report_id,))
    new_count = cursor.fetchone()[0]
    conn.commit()
    conn.close()
    return new_count

def get_stats():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM reports")
    total = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM reports WHERE status='Active'")
    active = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM reports WHERE status='Resolved'")
    resolved = cursor.fetchone()[0]
    cursor.execute("SELECT severity, COUNT(*) FROM reports GROUP BY severity")
    severity_rows = cursor.fetchall()
    severities = {'Low': 0, 'Medium': 0, 'High': 0}
    for row in severity_rows:
        if row[0] in severities:
            severities[row[0]] = row[1]
    cursor.execute("SELECT category, COUNT(*) FROM reports GROUP BY category")
    category_rows = cursor.fetchall()
    categories = {}
    for row in category_rows:
        categories[row[0]] = row[1]
    conn.close()
    return {'total': total, 'active': active, 'resolved': resolved, 'severity': severities, 'category': categories}
