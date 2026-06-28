import aiosqlite
import os

DB_PATH = os.environ.get("DB_PATH", "/data/metals.db")


async def get_db():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS holdings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                metal TEXT NOT NULL CHECK(metal IN ('gold','silver','platinum','palladium')),
                description TEXT NOT NULL,
                unit TEXT NOT NULL CHECK(unit IN ('oz','g','kg')),
                quantity REAL NOT NULL CHECK(quantity > 0),
                cost_basis REAL NOT NULL CHECK(cost_basis >= 0),
                purchase_date TEXT,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS price_cache (
                metal TEXT PRIMARY KEY,
                price_usd REAL NOT NULL,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS coins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                issuer TEXT NOT NULL,
                reference TEXT,
                n_number TEXT,
                title TEXT NOT NULL,
                year TEXT,
                gregorian_year INTEGER,
                mintmark TEXT,
                marks TEXT,
                ext_references TEXT,
                comment TEXT,
                quantity INTEGER DEFAULT 1,
                for_exchange INTEGER DEFAULT 0,
                grade TEXT,
                from_set INTEGER DEFAULT 0,
                buying_price REAL,
                estimate REAL,
                private_comment TEXT,
                public_comment TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.commit()
