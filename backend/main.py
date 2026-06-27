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

app = FastAPI(title="Precious Metals Tracker")

FRONTEND_DIR = os.environ.get("FRONTEND_DIR", "/app/frontend")


@app.on_event("startup")
async def startup():
    await init_db()


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


# --- Serve frontend ---
app.mount("/static", StaticFiles(directory=f"{FRONTEND_DIR}/static"), name="static")


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    return FileResponse(f"{FRONTEND_DIR}/index.html")
