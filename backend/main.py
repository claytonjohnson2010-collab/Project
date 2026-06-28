from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional
import asyncio
import aiosqlite
import os

from backend.database import get_db, init_db
from backend.prices import get_prices, convert_to_oz, fetch_history, fetch_metrics, TICKERS
from backend.coins import seed_coins

app = FastAPI(title="Precious Metals Tracker")

FRONTEND_DIR = os.environ.get("FRONTEND_DIR", "/app/frontend")


@app.on_event("startup")
async def startup():
    await init_db()
    await seed_coins()


# --- Models ---

class HoldingCreate(BaseModel):
    metal: str
    description: str
    unit: str
    quantity: float = Field(gt=0)
    cost_basis: float = Field(ge=0)
    purchase_date: Optional[str] = None
    notes: Optional[str] = None


class HoldingUpdate(BaseModel):
    description: Optional[str] = None
    unit: Optional[str] = None
    quantity: Optional[float] = Field(default=None, gt=0)
    cost_basis: Optional[float] = Field(default=None, ge=0)
    purchase_date: Optional[str] = None
    notes: Optional[str] = None


# --- Holdings API ---

@app.get("/api/holdings")
async def list_holdings(db: aiosqlite.Connection = Depends(get_db)):
    rows = await db.execute_fetchall("SELECT * FROM holdings ORDER BY metal, created_at")
    return [dict(r) for r in rows]


@app.post("/api/holdings", status_code=201)
async def create_holding(body: HoldingCreate, db: aiosqlite.Connection = Depends(get_db)):
    valid_metals = ("gold", "silver", "platinum", "palladium")
    valid_units = ("oz", "g", "kg")
    if body.metal not in valid_metals:
        raise HTTPException(400, f"metal must be one of {valid_metals}")
    if body.unit not in valid_units:
        raise HTTPException(400, f"unit must be one of {valid_units}")
    cur = await db.execute(
        """INSERT INTO holdings (metal, description, unit, quantity, cost_basis, purchase_date, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (body.metal, body.description, body.unit, body.quantity,
         body.cost_basis, body.purchase_date, body.notes),
    )
    await db.commit()
    row = await db.execute_fetchall("SELECT * FROM holdings WHERE id = ?", (cur.lastrowid,))
    return dict(row[0])


@app.put("/api/holdings/{holding_id}")
async def update_holding(holding_id: int, body: HoldingUpdate, db: aiosqlite.Connection = Depends(get_db)):
    existing = await db.execute_fetchall("SELECT * FROM holdings WHERE id = ?", (holding_id,))
    if not existing:
        raise HTTPException(404, "Holding not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        return dict(existing[0])
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    await db.execute(
        f"UPDATE holdings SET {set_clause} WHERE id = ?",
        (*updates.values(), holding_id),
    )
    await db.commit()
    row = await db.execute_fetchall("SELECT * FROM holdings WHERE id = ?", (holding_id,))
    return dict(row[0])


@app.delete("/api/holdings/{holding_id}", status_code=204)
async def delete_holding(holding_id: int, db: aiosqlite.Connection = Depends(get_db)):
    result = await db.execute("DELETE FROM holdings WHERE id = ?", (holding_id,))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Holding not found")


# --- Prices & Portfolio Summary ---

@app.get("/api/prices")
async def current_prices():
    return await get_prices()


@app.get("/api/portfolio")
async def portfolio_summary(db: aiosqlite.Connection = Depends(get_db)):
    holdings = await db.execute_fetchall("SELECT * FROM holdings")
    prices = await get_prices()

    metals = {}
    total_cost = 0.0
    total_value = 0.0

    for row in holdings:
        h = dict(row)
        metal = h["metal"]
        oz = convert_to_oz(h["quantity"], h["unit"])
        price = prices.get(metal, 0)
        market_value = oz * price
        cost = h["cost_basis"]
        total_cost += cost
        total_value += market_value

        if metal not in metals:
            metals[metal] = {
                "metal": metal,
                "total_oz": 0,
                "total_cost": 0,
                "market_value": 0,
                "price_per_oz": price,
                "holdings_count": 0,
            }
        metals[metal]["total_oz"] += oz
        metals[metal]["total_cost"] += cost
        metals[metal]["market_value"] += market_value
        metals[metal]["holdings_count"] += 1

    for m in metals.values():
        m["gain_loss"] = m["market_value"] - m["total_cost"]
        m["gain_loss_pct"] = (
            (m["gain_loss"] / m["total_cost"] * 100) if m["total_cost"] > 0 else 0
        )

    return {
        "total_cost": total_cost,
        "total_value": total_value,
        "total_gain_loss": total_value - total_cost,
        "total_gain_loss_pct": (
            ((total_value - total_cost) / total_cost * 100) if total_cost > 0 else 0
        ),
        "prices": prices,
        "by_metal": list(metals.values()),
    }


# --- Historical Data ---

@app.get("/api/history/{metal}")
async def metal_history(
    metal: str,
    range: str = Query("1M", pattern="^(1W|1M|3M|6M|1Y|5Y)$"),
):
    if metal not in TICKERS:
        raise HTTPException(400, f"metal must be one of {list(TICKERS.keys())}")
    return await fetch_history(metal, range)


# --- Metrics (52-week high/low, ratio) ---

@app.get("/api/metrics")
async def all_metrics():
    results = await asyncio.gather(
        *[fetch_metrics(m) for m in TICKERS],
        return_exceptions=True,
    )
    data = {}
    for metal, result in zip(TICKERS.keys(), results):
        data[metal] = result if isinstance(result, dict) else {}

    # Gold/Silver ratio
    gp = data.get("gold", {}).get("regular_market_price")
    sp = data.get("silver", {}).get("regular_market_price")
    data["gold_silver_ratio"] = round(gp / sp, 2) if gp and sp else None

    return data


# --- Coin Collection ---

@app.get("/api/coins")
async def list_coins(
    db: aiosqlite.Connection = Depends(get_db),
    search: Optional[str] = None,
    issuer: Optional[str] = None,
    grade: Optional[str] = None,
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
):
    clauses, params = [], []
    if search:
        term = f"%{search}%"
        clauses.append(
            "(issuer LIKE ? OR title LIKE ? OR reference LIKE ? OR grade LIKE ?"
            " OR comment LIKE ? OR public_comment LIKE ? OR private_comment LIKE ?)"
        )
        params.extend([term] * 7)
    if issuer:
        clauses.append("issuer = ?")
        params.append(issuer)
    if grade:
        clauses.append("grade = ?")
        params.append(grade)
    if year_from:
        clauses.append("gregorian_year >= ?")
        params.append(year_from)
    if year_to:
        clauses.append("gregorian_year <= ?")
        params.append(year_to)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = await db.execute_fetchall(
        f"SELECT * FROM coins {where} ORDER BY issuer, gregorian_year, reference",
        params,
    )
    return [dict(r) for r in rows]


@app.get("/api/coins/stats")
async def coins_stats(db: aiosqlite.Connection = Depends(get_db)):
    totals = await db.execute_fetchall(
        "SELECT COUNT(*) as n, SUM(estimate) as est, SUM(buying_price) as cost,"
        " SUM(for_exchange) as exch FROM coins"
    )
    t = dict(totals[0])

    by_issuer = await db.execute_fetchall(
        "SELECT issuer, COUNT(*) as count, SUM(estimate) as estimate"
        " FROM coins GROUP BY issuer ORDER BY count DESC"
    )
    grades = await db.execute_fetchall(
        "SELECT COALESCE(NULLIF(grade,''), 'Ungraded') as grade, COUNT(*) as count"
        " FROM coins GROUP BY grade ORDER BY count DESC"
    )
    decades = await db.execute_fetchall(
        """SELECT
             CASE WHEN gregorian_year IS NULL THEN 'Unknown'
                  ELSE CAST(gregorian_year/10*10 AS TEXT) || 's' END AS decade,
             COUNT(*) as count
           FROM coins
           GROUP BY decade
           ORDER BY MIN(gregorian_year)"""
    )
    dups = await db.execute_fetchall(
        """SELECT COUNT(*) as n FROM (
             SELECT issuer, reference, year, mintmark
             FROM coins
             GROUP BY issuer, reference, year, mintmark
             HAVING COUNT(*) > 1
           )"""
    )
    return {
        "total_coins": t["n"] or 0,
        "total_estimate": round(t["est"] or 0, 2),
        "total_cost": round(t["cost"] or 0, 2),
        "for_exchange_count": t["exch"] or 0,
        "duplicates_count": dict(dups[0])["n"] or 0,
        "by_issuer": [dict(r) for r in by_issuer],
        "grade_distribution": [dict(r) for r in grades],
        "decade_distribution": [dict(r) for r in decades],
    }


@app.get("/api/coins/duplicates")
async def coins_duplicates(db: aiosqlite.Connection = Depends(get_db)):
    groups = await db.execute_fetchall(
        """SELECT issuer, reference, title, year, mintmark, COUNT(*) as count
           FROM coins
           GROUP BY issuer, reference, year, mintmark
           HAVING COUNT(*) > 1"""
    )
    results = []
    for g in groups:
        gr = dict(g)
        detail = await db.execute_fetchall(
            "SELECT * FROM coins WHERE issuer=? AND reference=? AND year=? AND mintmark=?",
            (gr["issuer"], gr["reference"], gr["year"], gr["mintmark"]),
        )
        results.append({**gr, "coins": [dict(c) for c in detail]})
    return results


@app.get("/api/coins/gaps")
async def coins_gaps(db: aiosqlite.Connection = Depends(get_db)):
    series = await db.execute_fetchall(
        """SELECT issuer, reference, title,
             MIN(gregorian_year) as min_year,
             MAX(gregorian_year) as max_year,
             COUNT(DISTINCT gregorian_year) as year_count
           FROM coins
           WHERE gregorian_year IS NOT NULL AND gregorian_year > 0
           GROUP BY issuer, reference
           HAVING year_count > 1 AND (max_year - min_year + 1) > year_count
           ORDER BY issuer, reference"""
    )
    results = []
    for s in series:
        sr = dict(s)
        yr_rows = await db.execute_fetchall(
            "SELECT DISTINCT gregorian_year FROM coins"
            " WHERE issuer=? AND reference=? AND gregorian_year IS NOT NULL"
            " ORDER BY gregorian_year",
            (sr["issuer"], sr["reference"]),
        )
        owned = set(r["gregorian_year"] for r in yr_rows)
        gaps  = sorted(set(range(sr["min_year"], sr["max_year"] + 1)) - owned)
        if gaps:
            results.append({
                "issuer": sr["issuer"],
                "reference": sr["reference"],
                "title": sr["title"],
                "years_owned": sorted(owned),
                "gaps": gaps,
                "min_year": sr["min_year"],
                "max_year": sr["max_year"],
            })
    return results


# --- Serve frontend ---
app.mount("/static", StaticFiles(directory=f"{FRONTEND_DIR}/static"), name="static")


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    return FileResponse(f"{FRONTEND_DIR}/index.html")
