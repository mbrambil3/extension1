from fastapi import FastAPI, APIRouter, Request, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta
import hashlib
import json


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

# Premium Key Models
class PremiumKey(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    key: str
    email: EmailStr
    product_code: Optional[str] = None
    order_id: Optional[str] = None
    status: str = Field(default="active")  # active | revoked
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: Optional[datetime] = None

class ClaimRequest(BaseModel):
    email: EmailStr

class ClaimResponse(BaseModel):
    key: str
    status: str

class ValidateKeyRequest(BaseModel):
    key: str

class ValidateKeyResponse(BaseModel):
    valid: bool
    plan: str  # 'premium' | 'free'
    status: Optional[str] = None
    expires_at: Optional[datetime] = None
    expires_at_ms: Optional[int] = None

# Admin create key
class AdminCreateKeyRequest(BaseModel):
    email: EmailStr
    days: Optional[int] = Field(default=30, ge=1, le=365)

class AdminCreateKeyResponse(BaseModel):
    key: str
    email: EmailStr
    expires_at: datetime


# Admin revoke key
class AdminRevokeKeyRequest(BaseModel):
    email: Optional[EmailStr] = None
    key: Optional[str] = None
    order_id: Optional[str] = None

class AdminRevokeKeyResponse(BaseModel):
    revoked_count: int

# Utility functions
SAFE_SECRET_ENV = 'LASTLINK_WEBHOOK_SECRET'


def _constant_time_equals(a: str, b: str) -> bool:
    return hashlib.sha256(a.encode()).digest() == hashlib.sha256(b.encode()).digest()


def generate_human_key() -> str:
    import secrets
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # sem caracteres confusos
    def block(n: int) -> str:
        return ''.join(secrets.choice(alphabet) for _ in range(n))
    return f"{block(4)}-{block(4)}-{block(4)}-{block(4)}"


async def ensure_unique_key() -> str:
    # Gera uma chave que não colida na base
    for _ in range(10):
        k = generate_human_key()
        existing = await db.premium_keys.find_one({'key': k})
        if not existing:
            return k
    # fallback improvável
    return f"{uuid.uuid4()}".upper()


async def revoke_keys(email: Optional[str] = None, order_id: Optional[str] = None):
    filt: Dict[str, Any] = { 'status': 'active' }
    if email:
        filt['email'] = email
    if order_id:
        filt['order_id'] = order_id
    await db.premium_keys.update_many(filt, { '$set': { 'status': 'revoked', 'updated_at': datetime.utcnow() } })


# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]


# ============ REMOVIDO: Lastlink Webhook e Claim por e-mail ============
# Rota antiga /api/webhooks/lastlink e /api/premium/claim foram removidas conforme solicitação


# ============ Premium APIs ============
@api_router.post('/premium/keys/validate', response_model=ValidateKeyResponse)
async def validate_key(req: ValidateKeyRequest):
    key_raw = (req.key or '').strip()
    if not key_raw:
        return ValidateKeyResponse(valid=False, plan='free', status='invalid')
    key_doc = await db.premium_keys.find_one({'key': key_raw})
    if not key_doc:
        return ValidateKeyResponse(valid=False, plan='free', status='not_found')
    status = key_doc.get('status')
    if status != 'active':
        return ValidateKeyResponse(valid=False, plan='free', status=status)
    # Checa expiração
    exp = key_doc.get('expires_at')
    try:
        if exp and isinstance(exp, str):
            # caso legado salvo como string
            exp = datetime.fromisoformat(exp)
    except Exception:
        exp = None
    if exp and datetime.utcnow() >= exp:
        return ValidateKeyResponse(valid=False, plan='free', status='expired', expires_at=exp, expires_at_ms=int(exp.timestamp()*1000) if exp else None)
    return ValidateKeyResponse(valid=True, plan='premium', status='active', expires_at=exp, expires_at_ms=int(exp.timestamp()*1000) if exp else None)


# ============ Admin APIs ============

def _get_admin_key() -> Optional[str]:
    return os.environ.get('ADMIN_KEY')


def _require_admin(request: Request):
    auth = request.headers.get('authorization') or request.headers.get('Authorization')
    if not auth or not auth.lower().startswith('bearer '):
        raise HTTPException(status_code=401, detail='Unauthorized')
    provided = auth.split(' ', 1)[1].strip()
    configured = _get_admin_key()
    if not configured:
        raise HTTPException(status_code=500, detail='ADMIN_KEY not configured')
    if not _constant_time_equals(provided, configured):
        raise HTTPException(status_code=401, detail='Unauthorized')


@api_router.post('/admin/keys/create', response_model=AdminCreateKeyResponse)
async def admin_create_key(request: Request, body: AdminCreateKeyRequest):
    _require_admin(request)
    email = body.email.lower().strip()
    days = body.days or 30
    now = datetime.utcnow()
    # Se já existir uma chave ativa não expirada para este e-mail, reutiliza
    existing = await db.premium_keys.find_one({'email': email, 'status': 'active'})
    if existing:
        exp = existing.get('expires_at')
        try:
            if exp and isinstance(exp, str):
                exp = datetime.fromisoformat(exp)
        except Exception:
            exp = None
        if exp and now < exp:
            return AdminCreateKeyResponse(key=existing['key'], email=email, expires_at=exp)
    # Cria nova
    key_val = await ensure_unique_key()
    expires_at = now + timedelta(days=days)
    pk = PremiumKey(key=key_val, email=email, product_code=None, order_id=None, expires_at=expires_at)
    await db.premium_keys.insert_one(pk.model_dump())
    return AdminCreateKeyResponse(key=key_val, email=email, expires_at=expires_at)


@api_router.post('/admin/keys/revoke', response_model=AdminRevokeKeyResponse)
async def admin_revoke_keys(request: Request, body: AdminRevokeKeyRequest):
    _require_admin(request)
    # Precisamos de ao menos um critério
    if not body.email and not body.key and not body.order_id:
        raise HTTPException(status_code=400, detail='Informe email, key ou order_id')
    filt: Dict[str, Any] = { 'status': 'active' }
    if body.email:
        filt['email'] = body.email.lower().strip()
    if body.key:
        filt['key'] = body.key.strip()
    if body.order_id:
        filt['order_id'] = body.order_id.strip()
    result = await db.premium_keys.update_many(filt, { '$set': { 'status': 'revoked', 'updated_at': datetime.utcnow() } })
    return AdminRevokeKeyResponse(revoked_count=result.modified_count)



@api_router.post('/admin/keys/revoke_all', response_model=AdminRevokeKeyResponse)
async def admin_revoke_all(request: Request):
    _require_admin(request)
    result = await db.premium_keys.update_many({'status': 'active'}, { '$set': { 'status': 'revoked', 'updated_at': datetime.utcnow() } })
    return AdminRevokeKeyResponse(revoked_count=result.modified_count)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()