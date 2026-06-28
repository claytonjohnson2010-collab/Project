import csv
import os
import aiosqlite

SEED_CSV = os.path.join(os.path.dirname(__file__), "coins_seed.csv")
DB_PATH = os.environ.get("DB_PATH", "/data/metals.db")


async def seed_coins():
    if not os.path.exists(SEED_CSV):
        return

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        count = await db.execute_fetchall("SELECT COUNT(*) as n FROM coins")
        if count[0]["n"] > 0:
            return

        rows_to_insert = []
        with open(SEED_CSV, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                bp  = row.get("Buying price (USD)", "").strip()
                est = row.get("Estimate (USD)", "").strip()
                yr  = row.get("Gregorian year", "").strip()
                qty = row.get("Quantity", "1").strip()
                rows_to_insert.append((
                    row.get("Issuer", "").strip(),
                    row.get("Reference", "").strip(),
                    row.get("N# number (with link)", "").strip(),
                    row.get("Title", "").strip(),
                    row.get("Year", "").strip(),
                    int(yr) if yr.lstrip("-").isdigit() else None,
                    row.get("Mintmark", "").strip(),
                    row.get("Marks", "").strip(),
                    row.get("References", "").strip(),
                    row.get("Comment", "").strip(),
                    int(qty) if qty.isdigit() else 1,
                    1 if row.get("For exchange", "").strip().upper() == "TRUE" else 0,
                    row.get("Grade", "").strip(),
                    1 if row.get("From set", "").strip().upper() == "TRUE" else 0,
                    float(bp)  if bp  else None,
                    float(est) if est else None,
                    row.get("Private comment", "").strip(),
                    row.get("Public comment", "").strip(),
                ))

        await db.executemany(
            """INSERT INTO coins
               (issuer, reference, n_number, title, year, gregorian_year,
                mintmark, marks, ext_references, comment, quantity, for_exchange,
                grade, from_set, buying_price, estimate, private_comment, public_comment)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            rows_to_insert,
        )
        await db.commit()
