import os
import logging
import random
import uuid
import bcrypt
import jwt
import csv
import io
import secrets
import base64
import hashlib
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, BackgroundTasks
from fastapi.responses import Response as PlainResponse
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / ".env")

try:
    from twilio.rest import Client as TwilioClient
except ImportError:
    TwilioClient = None

# ============= SETUP =============
def _clean_env(name: str) -> str:
    val = os.environ[name].strip()
    if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
        val = val[1:-1].strip()
    return val

mongo_url = _clean_env("MONGO_URL")
client = AsyncIOMotorClient(mongo_url)
db = client[_clean_env("DB_NAME")]

JWT_ALGORITHM = "HS256"
JWT_SECRET = _clean_env("JWT_SECRET")

app = FastAPI(
    title="R.O.G Financial CRM API",
    description="💰 Enterprise Life Insurance CRM with Auto-Dialer & Analytics",
    version="1.0.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
)
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("rog_crm")

# ============= UTILITIES =============
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def new_id() -> str:
    return str(uuid.uuid4())

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

# ============= ENCRYPTION =============
def _fernet_key() -> bytes:
    raw = os.environ.get("INTAKE_ENCRYPTION_KEY", "rog_default_key_change_me")
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)

_fernet_holder: dict = {"f": Fernet(_fernet_key())}
SENSITIVE_FIELDS = ("ssn", "account_number", "routing_number", "drivers_license")

def _get_fernet() -> Fernet:
    return _fernet_holder["f"]

def _set_fernet(f: Fernet) -> None:
    _fernet_holder["f"] = f

def _build_fernet(raw_key: str) -> Fernet:
    digest = hashlib.sha256(raw_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))

def encrypt_val(v):
    if v is None or v == "":
        return None
    return _get_fernet().encrypt(str(v).encode("utf-8")).decode("utf-8")

def decrypt_val(v):
    if v is None or v == "":
        return None
    try:
        return _get_fernet().decrypt(str(v).encode("utf-8")).decode("utf-8")
    except (InvalidToken, Exception):
        return v

def encrypt_submission(sub: dict) -> dict:
    if not sub:
        return sub
    out = dict(sub)
    for f in SENSITIVE_FIELDS:
        out[f] = encrypt_val(out.get(f))
    return out

def decrypt_submission(sub: dict) -> dict:
    if not sub:
        return sub
    out = dict(sub)
    for f in SENSITIVE_FIELDS:
        out[f] = decrypt_val(out.get(f))
    return out

# ============= AUTHENTICATION =============
def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        "type": "access"
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def require_roles(*roles: str):
    async def _guard(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return _guard

# ============= AUTO-DIALER =============
class DialerLeadIn(BaseModel):
    """Auto-dialer lead configuration"""
    lead_ids: List[str]
    agent_id: str
    priority: Literal["high", "medium", "low"] = "medium"
    max_attempts: int = 3
    retry_on_no_answer: bool = True
    voicemail_script: Optional[str] = None

class DialerCampaignIn(BaseModel):
    """Create a dialing campaign"""
    name: str
    description: Optional[str] = None
    lead_ids: List[str]
    assigned_agents: List[str]  # Round-robin distribution
    priority: Literal["high", "medium", "low"] = "medium"
    max_calls_per_hour: int = 40  # TCPA compliance
    max_attempts_per_lead: int = 3
    do_not_call_check: bool = True
    voicemail_script: Optional[str] = None
    start_time: Optional[str] = None  # ISO datetime
    end_time: Optional[str] = None
    status: Literal["draft", "active", "paused", "completed"] = "draft"

class DialerCallLog(BaseModel):
    """Call attempt record"""
    id: str = Field(default_factory=new_id)
    campaign_id: str
    lead_id: str
    agent_id: str
    phone: str
    call_status: Literal["connected", "no_answer", "busy", "voicemail", "invalid", "do_not_call"] = "no_answer"
    call_duration_seconds: int = 0
    attempt_number: int = 1
    notes: Optional[str] = None
    disposition: Optional[Literal["callback", "interested", "not_interested", "wrong_number"]] = None
    recorded_call_url: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

class DialerAgentStats(BaseModel):
    """Agent dialing statistics"""
    agent_id: str
    calls_today: int = 0
    connections_today: int = 0
    voicemails_today: int = 0
    contact_rate: float = 0.0  # Percentage
    avg_call_duration: int = 0  # Seconds
    callbacks_pending: int = 0

@api.post("/dialer/campaigns")
async def create_dialer_campaign(body: DialerCampaignIn, user: dict = Depends(require_roles("admin", "manager"))):
    """Create an auto-dialer campaign"""
    doc = {
        "id": new_id(),
        "name": body.name,
        "description": body.description,
        "lead_ids": body.lead_ids,
        "assigned_agents": body.assigned_agents,
        "priority": body.priority,
        "max_calls_per_hour": body.max_calls_per_hour,
        "max_attempts_per_lead": body.max_attempts_per_lead,
        "do_not_call_check": body.do_not_call_check,
        "voicemail_script": body.voicemail_script,
        "start_time": body.start_time,
        "end_time": body.end_time,
        "status": body.status,
        "created_by": user["id"],
        "created_at": now_iso(),
        "stats": {
            "total_leads": len(body.lead_ids),
            "calls_completed": 0,
            "contacts_made": 0,
            "voicemails_left": 0,
        }
    }
    await db.dialer_campaigns.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@api.get("/dialer/campaigns")
async def list_dialer_campaigns(user: dict = Depends(get_current_user)):
    """List dialer campaigns"""
    if user.get("role") == "agent":
        # Agents see campaigns assigned to them
        campaigns = await db.dialer_campaigns.find(
            {"assigned_agents": user.get("agent_id")},
            {"_id": 0}
        ).to_list(1000)
    else:
        campaigns = await db.dialer_campaigns.find({}, {"_id": 0}).to_list(1000)
    return campaigns

@api.post("/dialer/campaigns/{campaign_id}/start")
async def start_dialer_campaign(campaign_id: str, user: dict = Depends(require_roles("admin", "manager"))):
    """Activate a dialer campaign"""
    campaign = await db.dialer_campaigns.find_one({"id": campaign_id})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    await db.dialer_campaigns.update_one(
        {"id": campaign_id},
        {"$set": {"status": "active", "started_at": now_iso()}}
    )
    
    logger.info(f"Campaign {campaign_id} started by {user['email']}")
    return {"ok": True, "campaign_id": campaign_id, "status": "active"}

@api.post("/dialer/campaigns/{campaign_id}/pause")
async def pause_dialer_campaign(campaign_id: str, user: dict = Depends(require_roles("admin", "manager"))):
    """Pause a dialer campaign"""
    await db.dialer_campaigns.update_one(
        {"id": campaign_id},
        {"$set": {"status": "paused", "paused_at": now_iso()}}
    )
    return {"ok": True, "campaign_id": campaign_id, "status": "paused"}

@api.post("/dialer/calls")
async def log_dialer_call(body: DialerCallLog, user: dict = Depends(get_current_user)):
    """Log a call attempt from the dialer"""
    if user.get("role") == "agent" and user.get("agent_id") != body.agent_id:
        raise HTTPException(status_code=403, detail="Cannot log calls for other agents")
    
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    
    await db.dialer_calls.insert_one(doc)
    
    # Update campaign stats
    campaign = await db.dialer_campaigns.find_one({"id": body.campaign_id})
    if campaign:
        update_obj = {"stats.calls_completed": campaign["stats"]["calls_completed"] + 1}
        if body.call_status == "connected":
            update_obj["stats.contacts_made"] = campaign["stats"]["contacts_made"] + 1
        elif body.call_status == "voicemail":
            update_obj["stats.voicemails_left"] = campaign["stats"]["voicemails_left"] + 1
        
        await db.dialer_campaigns.update_one(
            {"id": body.campaign_id},
            {"$set": update_obj}
        )
    
    return {k: v for k, v in doc.items() if k != "_id"}

@api.get("/dialer/calls/campaign/{campaign_id}")
async def get_campaign_calls(campaign_id: str, user: dict = Depends(get_current_user)):
    """Get all calls for a campaign"""
    calls = await db.dialer_calls.find(
        {"campaign_id": campaign_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(10000)
    return calls

@api.get("/dialer/agent-stats/{agent_id}")
async def get_agent_dialer_stats(agent_id: str, user: dict = Depends(get_current_user)):
    """Get dialer statistics for an agent"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    calls = await db.dialer_calls.find(
        {"agent_id": agent_id, "created_at": {"$gte": today}},
        {"_id": 0}
    ).to_list(5000)
    
    total_calls = len(calls)
    connected = sum(1 for c in calls if c["call_status"] == "connected")
    voicemails = sum(1 for c in calls if c["call_status"] == "voicemail")
    total_duration = sum(c.get("call_duration_seconds", 0) for c in calls)
    callbacks = sum(1 for c in calls if c.get("disposition") == "callback")
    
    contact_rate = round((connected / total_calls * 100), 1) if total_calls > 0 else 0
    avg_duration = round(total_duration / total_calls) if total_calls > 0 else 0
    
    return {
        "agent_id": agent_id,
        "calls_today": total_calls,
        "connections_today": connected,
        "voicemails_today": voicemails,
        "contact_rate": contact_rate,
        "avg_call_duration": avg_duration,
        "callbacks_pending": callbacks,
        "date": today,
    }

@api.get("/dialer/do-not-call/check")
async def check_do_not_call(phone: str, user: dict = Depends(require_roles("admin", "manager"))):
    """Check if number is on DNC list (TCPA compliance)"""
    # TODO: Integrate with real DNC database
    dnc_record = await db.dnc_list.find_one({"phone": phone})
    return {
        "phone": phone,
        "on_dnc_list": bool(dnc_record),
        "date_added": dnc_record.get("created_at") if dnc_record else None,
    }

@api.post("/dialer/do-not-call/add")
async def add_to_do_not_call(phone: str, user: dict = Depends(require_roles("admin", "manager"))):
    """Add number to DNC list"""
    doc = {
        "id": new_id(),
        "phone": phone,
        "added_by": user["id"],
        "created_at": now_iso(),
    }
    await db.dnc_list.insert_one(doc)
    return {"ok": True, "phone": phone}

# ============= HEALTH CHECK =============
@app.get("/health")
async def health():
    return {"status": "ok"}

@api.get("/health")
async def api_health():
    return {"status": "ok"}

# ============= STARTUP =============
@app.on_event("startup")
async def on_startup():
    try:
        # Load encryption key
        try:
            doc = await db.settings.find_one({"key": "encryption_key"})
            if doc and doc.get("raw"):
                _set_fernet(_build_fernet(doc["raw"]))
                logger.info("✅ Loaded encryption key")
        except Exception as e:
            logger.warning(f"⚠️  Could not load encryption key: {e}")
        
        # Seed admin user
        admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower()
        admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
        
        existing = await db.users.find_one({"email": admin_email})
        if not existing:
            await db.users.insert_one({
                "id": new_id(),
                "email": admin_email,
                "name": "Admin",
                "role": "admin",
                "password_hash": hash_password(admin_password),
                "created_at": now_iso(),
            })
            logger.info(f"✅ Created admin user: {admin_email}")
        
        logger.info("🚀 R.O.G Financial CRM API Ready")
    except Exception as e:
        logger.exception(f"❌ Startup error: {e}")

@app.on_event("shutdown")
async def on_shutdown():
    client.close()
    logger.info("🛑 API Shutdown")

app.include_router(api)

# ============= CORS =============
origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
