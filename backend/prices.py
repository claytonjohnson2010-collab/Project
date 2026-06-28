import httpx
import logging
from datetime import datetime, timedelta
import aiosqlite
import os

logger = logging.getLogger(__name__)

DB_PATH = os.environ.get("DB_PATH", "/data/metals.db")
CACHE_TTL = int(os.environ.get("PRICE_CACHE_TTL_MINUTES", "5"))

TICKERS = {
    "gold": "GC=F",
    "silver": "SI=F",
    "platinum": "PL=F",
    "palladium": "PA=F",
}

OZ_TO_G = 31.1035

RANGE_TO_YF = {
    "1D": ("5m", "1d"),
    "1W": ("1d", "5d"),
    "1M": ("1d", "1mo"),
    "3M": ("1d", "3mo"),
    "6M": ("1wk", "6mo"),
    "1Y": ("1wk", "1y"),
    "5Y": ("1mo", "5y"),
}


async def fetch_live_prices() -> dict[str, float]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get("https://metals.live/api/spot")
            resp.raise_for_status()
            data = resp.json()
            prices = {}
            for item in data:
                name = item.get("metal", "").lower()
                if name in TICKERS:
                    prices[name] = float(item["price"])
            if prices:
                return prices
    except Exception as e:
        logger.warning(f"metals.live fetch failed: {e}")

    try:
        prices = {}
        async with httpx.AsyncClient(timeout=10) as client:
            for metal, ticker in TICKERS.items():
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
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cutoff = (datetime.utcnow() - timedelta(minutes=CACHE_TTL)).isoformat()
        rows = await db.execute_fetchall(
            "SELECT metal, price_usd, updated_at FROM price_cache WHERE updated_at > ?", (cutoff,)
        )
        cached = {r["metal"]: r["price_usd"] for r in rows}
        if len(cached) == 4:
            return cached

        fresh = await fetch_live_prices()
        if fresh:
            for metal, price in fresh.items():
                await db.execute(
                    "INSERT OR REPLACE INTO price_cache (metal, price_usd, updated_at) VALUES (?, ?, datetime('now'))",
                    (metal, price),
                )
            await db.commit()
            return fresh

        all_rows = await db.execute_fetchall("SELECT metal, price_usd FROM price_cache")
        return {r["metal"]: r["price_usd"] for r in all_rows}


async def fetch_history(metal: str, range_key: str) -> dict:
    """Return {labels: [...], data: [...]} for the requested range."""
    ticker = TICKERS.get(metal)
    if not ticker:
        return {"labels": [], "data": []}

    interval, yf_range = RANGE_TO_YF.get(range_key, ("1d", "1mo"))

    try:
        url = (
            f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
            f"?interval={interval}&range={yf_range}"
        )
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            d = r.json()
            result = d["chart"]["result"][0]
            timestamps = result["timestamp"]
            closes = result["indicators"]["quote"][0]["close"]
            labels = []
            data = []
            for ts, close in zip(timestamps, closes):
                if close is None:
                    continue
                dt = datetime.utcfromtimestamp(ts)
                if range_key == "1D":
                    labels.append(dt.strftime("%H:%M"))
                elif range_key in ("1W", "1M", "3M", "6M"):
                    labels.append(dt.strftime("%b %d"))
                else:
                    labels.append(dt.strftime("%b %Y"))
                data.append(round(close, 2))
            return {"labels": labels, "data": data}
    except Exception as e:
        logger.warning(f"History fetch failed for {metal} {range_key}: {e}")
        return {"labels": [], "data": []}


async def fetch_metrics(metal: str) -> dict:
    """Return 52-week high/low and other meta for a metal."""
    ticker = TICKERS.get(metal)
    if not ticker:
        return {}
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1y"
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            d = r.json()
            meta = d["chart"]["result"][0]["meta"]
            closes = d["chart"]["result"][0]["indicators"]["quote"][0]["close"]
            valid = [c for c in closes if c is not None]
            return {
                "fifty_two_week_high": round(max(valid), 2) if valid else None,
                "fifty_two_week_low": round(min(valid), 2) if valid else None,
                "regular_market_price": meta.get("regularMarketPrice"),
                "previous_close": meta.get("chartPreviousClose"),
            }
    except Exception as e:
        logger.warning(f"Metrics fetch failed for {metal}: {e}")
        return {}


def convert_to_oz(quantity: float, unit: str) -> float:
    if unit == "oz":
        return quantity
    if unit == "g":
        return quantity / OZ_TO_G
    if unit == "kg":
        return quantity * 1000 / OZ_TO_G
    return quantity
