"""Environment-backed configuration. Nothing secret is committed."""

import os
from pathlib import Path

import certifi
from dotenv import load_dotenv

# macOS python.org builds ship no CA bundle, so aiohttp's TLS handshake with
# agentverse.ai fails with CERTIFICATE_VERIFY_FAILED. Point OpenSSL at
# certifi's bundle before anything opens a connection. Harmless if already set.
os.environ.setdefault("SSL_CERT_FILE", certifi.where())
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())

AGENTS_DIR = Path(__file__).parent
load_dotenv(AGENTS_DIR / ".env")
load_dotenv(AGENTS_DIR.parent / ".env")  # share keys with the Node worker

# --- Fetch.ai ------------------------------------------------------------
AGENT_SEED_ORCHESTRATOR = os.getenv("AGENT_SEED_ORCHESTRATOR", "")
AGENT_SEED_INGEST = os.getenv("AGENT_SEED_INGEST", "")
AGENT_SEED_SIMULATION = os.getenv("AGENT_SEED_SIMULATION", "")
AGENTVERSE_API_KEY = os.getenv("AGENTVERSE_API_KEY", "")
AGENT_HANDLE = os.getenv("AGENT_HANDLE", "")
BUREAU_PORT = int(os.getenv("BUREAU_PORT", "8100"))

# --- SpacetimeDB ---------------------------------------------------------
STDB_URL = os.getenv("STDB_URL", "https://maincloud.spacetimedb.com").rstrip("/")
STDB_DATABASE = os.getenv("STDB_DATABASE", "calhacks-wwif0")
STDB_TOKEN = os.getenv("STDB_TOKEN", "")

# --- Apify ---------------------------------------------------------------
APIFY_TOKEN = os.getenv("APIFY_TOKEN", "")
APIFY_REEL_ACTOR = os.getenv("APIFY_REEL_ACTOR", "apify/instagram-reel-scraper")

# --- The browser app -----------------------------------------------------
ISLAND_URL = os.getenv("ISLAND_URL", "http://localhost:5173").rstrip("/")

# --- Demo data -----------------------------------------------------------
# The profile the agent acts for. STDB_TOKEN must be its owner's identity.
PROFILE_ID = os.getenv("PROFILE_ID", "")
CAMPAIGN_ID = os.getenv("CAMPAIGN_ID", "c1")
FALLBACK_VIDEO_ID = os.getenv("FALLBACK_VIDEO_ID", "")

# --- Tuning --------------------------------------------------------------
RUN_TIMEOUT_SECONDS = int(os.getenv("RUN_TIMEOUT_SECONDS", "300"))
POLL_SECONDS = float(os.getenv("POLL_SECONDS", "1.5"))
WORKER_TIMEOUT_SECONDS = int(os.getenv("WORKER_TIMEOUT_SECONDS", "420"))
LOCAL_ONLY = os.getenv("AGENT_LOCAL_ONLY", "").lower() in ("1", "true", "yes")
