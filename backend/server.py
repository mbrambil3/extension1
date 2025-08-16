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
from datetime import datetime
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

# Webhook generic model (store raw)
class WebhookAck(BaseModel):
    received: bool
    processed: bool
    event: Optional[str] = None
    idempotent: bool = False


# Utility functions
SAFE_SECRET_ENV = 'LASTLINK_WEBHOOK_SECRET'


def _constant_time_equals(a: str, b: str) -> bool:
    return hashlib.sha256(a.encode()).digest() == hashlib.sha256(b.encode()).digest()


def _extract_header_secret(request: Request) -> Optional[str]:
    # Try common headers
    auth = request.headers.get('authorization') or request.headers.get('Authorization')
    if auth and auth.lower().startswith('bearer '):
        return auth.split(' ', 1)[1].strip()
    for h in ['x-webhook-token', 'X-Webhook-Token', 'x-lastlink-secret', 'X-Lastlink-Secret', 'x-lastlink-token', 'X-Lastlink-Token']:
        token = request.headers.get(h)
        if token:
            return token.strip()
    # Fallback: allow token via query string ?token=... or ?secret=...
    try:
        qp = request.query_params
        for k in ['token', 'secret', 'webhook_secret']:
            v = qp.get(k)
            if v:
                return v.strip()
    except Exception:
        pass
    return None


def _event_uid(payload: Dict[str, Any]) -> str:
    # Prefer strong identifiers from provider
    for k in ['id', 'event_id', 'delivery_id', 'webhook_id', 'pedido_id', 'order_id']:
        v = payload.get(k)
        if isinstance(v, (str, int)) and str(v):
            return f"ll_{k}_{v}"
    # Fallback: hash of normalized content
    try:
        norm = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    except Exception:
        norm = str(payload)
    h = hashlib.sha256(norm.encode('utf-8')).hexdigest()
    return f"ll_hash_{h[:32]}"


def _extract_event_name(payload: Dict[str, Any]) -> str:
    # Try query param style fallback e.g., payment-success redirect
    # If payload empty, attempt to parse common names from nested data
    candidates = [
        payload.get('event'), payload.get('type'), payload.get('evento'), payload.get('acao'), payload.get('status'),
    ]
    for c in candidates:
        if isinstance(c, str) and c.strip():
            return c.strip()
    # Some payloads may nest
    data = payload.get('data') or {}
    for k in ['event', 'type', 'status']:
        v = isinstance(data, dict) and data.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return 'desconhecido'


def _extract_email(payload: Dict[str, Any]) -> Optional[str]:
    paths = [
        ['email'], ['cliente', 'email'], ['customer', 'email'], ['buyer', 'email'], ['purchaser', 'email'],
        ['user', 'email'], ['member', 'email'], ['data', 'email'], ['data', 'customer', 'email'],
        ['params', 'email'], ['query', 'email']
    ]
    cur: Any = None
    for p in paths:
        cur = payload
        try:
            for key in p:
                cur = cur[key]
            if isinstance(cur, str) and '@' in cur:
                return cur.strip()
        except Exception:
            continue
    return None


def _extract_order_id(payload: Dict[str, Any]) -> Optional[str]:
    paths = [
        ['order_id'], ['pedido_id'], ['purchase', 'id'], ['order', 'id'], ['data', 'order_id']
    ]
    for p in paths:
        cur: Any = payload
        try:
            for k in p:
                cur = cur[k]
            if isinstance(cur, (str, int)):
                return str(cur)
        except Exception:
            continue
    return None


def _extract_product_code(payload: Dict[str, Any]) -> Optional[str]:
    paths = [
        ['product_code'], ['produto', 'codigo'], ['product', 'code'], ['plan', 'code'], ['data', 'product_code'],
        ['checkout', 'code']
    ]
    for p in paths:
        cur: Any = payload
        try:
            for k in p:
                cur = cur[k]
            if isinstance(cur, (str, int)) and str(cur):
                return str(cur)
        except Exception:
            continue
    return None


def generate_human_key() -> str:
    import secrets
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # sem caracteres confusos
    def block(n: int) -> str:
        return ''.join(secrets.choice(alphabet) for _ in range(n))
    return f"{block(4)}-{block(4)}-{block(4)}-{block(4)}"


async def create_or_get_active_key(email: str, product_code: Optional[str], order_id: Optional[str]) -> PremiumKey:
    # Idempotente por (email, order_id) se houver
    query: Dict[str, Any] = { 'email': email, 'status': 'active' }
    if order_id:
        query['order_id'] = order_id
    elif product_code:
        query['product_code'] = product_code
    existing = await db.premium_keys.find_one(query)
    if existing:
        return PremiumKey(**existing)
    # Gera nova
    key_val = generate_human_key()
    pk = PremiumKey(key=key_val, email=email, product_code=product_code, order_id=order_id)
    await db.premium_keys.insert_one(pk.model_dump())
    return pk


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
    # Extra: se payload vier vazio mas com query params (caso de GET/redirect), ainda assim não criamos KEY


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


# ============ Lastlink Webhook ============
@api_router.post('/webhooks/lastlink', response_model=WebhookAck)
async def lastlink_webhook(request: Request):
    # Validate secret/token
    configured = os.environ.get(SAFE_SECRET_ENV)
    if not configured:
        logging.error('LASTLINK_WEBHOOK_SECRET not configured')
        raise HTTPException(status_code=500, detail='Webhook not configured')
    provided = _extract_header_secret(request)
    if not provided or not _constant_time_equals(provided, configured):
        raise HTTPException(status_code=401, detail='Unauthorized')

    # Access raw body and parse JSON safely
    body_bytes = await request.body()
    try:
        payload = json.loads(body_bytes.decode('utf-8')) if body_bytes else {}
    except Exception:
        payload = {}

    event_name_raw = _extract_event_name(payload).lower()
    uid = _event_uid(payload)

    # Idempotência: se já processado, só ack
    already = await db.webhook_events.find_one({'uid': uid})
    if already:
        return WebhookAck(received=True, processed=False, event=event_name_raw, idempotent=True)

    # Persist raw event
    doc = {
        'id': str(uuid.uuid4()),
        'uid': uid,
        'event': event_name_raw,
        'payload': payload,
        'headers': {k: v for k, v in request.headers.items()},
        'received_at': datetime.utcnow(),
        'processed': False,
    }

    # Process business logic
    processed = False
    try:
        email = _extract_email(payload)
        order_id = _extract_order_id(payload)
        product_code = _extract_product_code(payload)

        # Normalize event labels (Portuguese from Lastlink UI)
        ev = event_name_raw
        # Map likely values
        compra_labels = ['compra completa', 'purchase_complete', 'purchase completed']
        refund_labels = ['pagamento reembolsado', 'refund', 'refunded']
        chargeback_labels = ['pagamento estornado', 'chargeback', 'dispute']
        cancel_labels = ['pedido de compra cancelado', 'cancelado', 'order_cancelled']

        if any(x in ev for x in compra_labels):
            if not email:
                logging.warning('Compra Completa sem e-mail no payload')
            else:
                _ = await create_or_get_active_key(email=email, product_code=product_code, order_id=order_id)
            processed = True
        elif any(x in ev for x in refund_labels) or any(x in ev for x in chargeback_labels) or any(x in ev for x in cancel_labels):
            # Revoga
            await revoke_keys(email=email, order_id=order_id)
            processed = True
        else:
            # Outros eventos: apenas registrar
            processed = False
    except Exception as e:
        logging.exception(f"Erro processando webhook: {e}")
        # Não lançar 5xx para não gerar reentrega infinita sem necessidade
        processed = False
    finally:
        doc['processed'] = processed
        await db.webhook_events.insert_one(doc)

    return WebhookAck(received=True, processed=processed, event=event_name_raw)


# ============ Premium APIs ============
@api_router.post('/premium/claim', response_model=ClaimResponse)
async def claim_premium_key(req: ClaimRequest):
    email = req.email.lower()
    # Busca chave ativa mais recente para este e-mail
    key_doc = await db.premium_keys.find_one({'email': email, 'status': 'active'})
    if not key_doc:
        raise HTTPException(status_code=404, detail='Nenhuma assinatura ativa encontrada para este e-mail')
    pk = PremiumKey(**key_doc)
    return ClaimResponse(key=pk.key, status=pk.status)


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
    return ValidateKeyResponse(valid=True, plan='premium', status='active')


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