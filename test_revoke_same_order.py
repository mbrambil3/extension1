#!/usr/bin/env python3
"""
Test revocation with same order_id (as it should work in real scenarios)
"""

import requests
import json
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv('/app/frontend/.env')

# Configuration
BASE_URL = os.getenv('REACT_APP_BACKEND_URL', 'https://readwise-chrome.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"
WEBHOOK_SECRET = "0e8cafc1171045df9b30c23db25a53df"

def test_revocation_same_order():
    session = requests.Session()
    
    # Test data - using unique identifiers to avoid idempotency issues
    email = "same-order-revoke@example.com"
    order_id = "SAME-ORDER-789"
    
    headers = {
        'Authorization': f'Bearer {WEBHOOK_SECRET}',
        'Content-Type': 'application/json'
    }
    
    print("=== Step 1: Create Purchase ===")
    purchase_payload = {
        "event": "Compra Completa",
        "order_id": order_id,
        "product_code": "C55E28191",
        "customer": {"email": email}
    }
    
    response = session.post(f"{API_BASE}/webhooks/lastlink", headers=headers, json=purchase_payload)
    print(f"Purchase webhook: {response.status_code} - {response.json()}")
    
    print("\n=== Step 2: Claim Key ===")
    claim_response = session.post(f"{API_BASE}/premium/claim", json={"email": email})
    print(f"Claim: {claim_response.status_code} - {claim_response.json()}")
    
    if claim_response.status_code != 200:
        print("Failed to claim key, stopping")
        return False
    
    key = claim_response.json().get('key')
    print(f"Got key: {key}")
    
    print("\n=== Step 3: Validate Key (Before Revoke) ===")
    validate_response = session.post(f"{API_BASE}/premium/keys/validate", json={"key": key})
    print(f"Validate before: {validate_response.status_code} - {validate_response.json()}")
    
    print("\n=== Step 4: Revoke via Refund Webhook (Same Order ID) ===")
    # In real scenarios, refund would reference the same order_id as the original purchase
    # But we need a different event identifier to avoid idempotency
    refund_payload = {
        "event": "Pagamento Reembolsado",
        "id": "REFUND-EVENT-789",  # Add unique event ID to avoid idempotency
        "order_id": order_id,  # Same order_id as purchase
        "product_code": "C55E28191",
        "customer": {"email": email}
    }
    
    revoke_response = session.post(f"{API_BASE}/webhooks/lastlink", headers=headers, json=refund_payload)
    print(f"Refund webhook: {revoke_response.status_code} - {revoke_response.json()}")
    
    print("\n=== Step 5: Validate Key (After Revoke) ===")
    validate_after = session.post(f"{API_BASE}/premium/keys/validate", json={"key": key})
    print(f"Validate after: {validate_after.status_code} - {validate_after.json()}")
    
    # Check if revocation worked
    after_data = validate_after.json()
    revoked = (not after_data.get('valid') and 
               after_data.get('plan') == 'free' and 
               after_data.get('status') == 'revoked')
    
    print(f"\n✅ Revocation test: {'PASSED' if revoked else 'FAILED'}")
    return revoked

if __name__ == "__main__":
    success = test_revocation_same_order()
    exit(0 if success else 1)