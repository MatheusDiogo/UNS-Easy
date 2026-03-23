import sqlite3
import os
from flask import g, current_app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(e=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(app):
    with app.app_context():
        db = get_db()

        # Create tables if they don't exist
        db.executescript("""
            CREATE TABLE IF NOT EXISTS use_cases (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT    NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS nodes (
                id          TEXT    PRIMARY KEY,
                use_case_id INTEGER NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
                parent_id   TEXT    REFERENCES nodes(id) ON DELETE CASCADE,
                name        TEXT    NOT NULL,
                flags       TEXT    NOT NULL DEFAULT '[]',
                position    INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS attributes (
                id        TEXT    PRIMARY KEY,
                node_id   TEXT    NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                name      TEXT    NOT NULL,
                value     TEXT    NOT NULL DEFAULT '',
                is_input  INTEGER NOT NULL DEFAULT 0,
                position  INTEGER NOT NULL DEFAULT 0
            );
        """)

        db.commit()