import httpx
import asyncio
import logging
from datetime import datetime, timedelta
import aiosqlite
import os


logger = logging.getLogger(__name__)

DB_PATH = os.environ.get("DB_PATH", "/data/metals.db")

# Cache TTL in minutes
CACHE_TTL = int(os.environ.get("PRICE_CACHE_TTL_MINUTES", "15"))

METAL_SYMBOLS = {
    "gold": "XAU",
    "silver": "XAG",
    "platinum": "XPT",
    "palladium": "XPD",
}

# oz to gram conversion
OZ_TO_G = 31.1035


async def fetch_live_prices() -> dict[str, float]:
    """Fetch spot prices in USD per troy oz from metals.live (free, no key required)."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get("https://metals.live/api/spot")
            resp.raise_for_status()
            data = resp.json()
            # metals.live returns list of {metal, price} dicts
            prices = {}
            for item in data:
                name = item.get("metal", "").lower()
                if name in METAL_SYMBOLS:
                    prices[name] = float(item["price"])
            if prices:
                return prices
    except Exception as e:
        logger.warning(f"metals.live fetch failed: {e}")

    # Fallback: Yahoo Finance via query1
    try:
        tickers = {"gold": "GC=F", "silver": "SI=F", "platinum": "PL=F", "palladium": "PA=F"}
        prices = {}
        async with httpx.AsyncClient(timeout=10) as client:
            for metal, ticker in tickers.items():
                url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d"
                r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
                if r.status_code == 200:
                    d = r.json()
                    price = d["chart"]["result"][0]["meta"]["regularMarketPrice"]
                    prices[metal] = float(price)
        if prices:
            return prices
    except Exception as e:
        logger.warning(f"Yahoo Finance fetch failed: {e}")

    return {}


async def get_prices() -> dict[str, float]:
    """Return cached prices, refreshing if stale."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cutoff = (datetime.utcnow() - timedelta(minutes=CACHE_TTL)).isoformat()
        rows = await db.execute_fetchall(
            "SELECT metal, price_usd, updated_at FROM price_cache WHERE updated_at > ?", (cutoff,)
        )
        cached = {r["metal"]: r["price_usd"] for r in rows}

        if len(cached) == 4:
            return cached

        # Need a refresh
        fresh = await fetch_live_prices()
        if fresh:
            for metal, price in fresh.items():
                await db.execute(
                    "INSERT OR REPLACE INTO price_cache (metal, price_usd, updated_at) VALUES (?, ?, datetime('now'))",
                    (metal, price),
                )
            await db.commit()
            return fresh

        # Return whatever we have cached even if stale
        all_rows = await db.execute_fetchall("SELECT metal, price_usd FROM price_cache")
        return {r["metal"]: r["price_usd"] for r in all_rows}


def convert_to_oz(quantity: float, unit: str) -> float:
    if unit == "oz":
        return quantity
    if unit == "g":
        return quantity / OZ_TO_G
    if unit == "kg":
        return quantity * 1000 / OZ_TO_G
    return quantity
