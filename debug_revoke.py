#!/usr/bin/env python3
"""
Debug script to test key revocation logic
"""

import requests
import json
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv('/app/frontend/.env')

# Configuration
BASE_URL = os.getenv('REACT_APP_BACKEND_URL', 'https://summary-pro.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"
WEBHOOK_SECRET = "0e8cafc1171045df9b30c23db25a53df"

def debug_revocation():
    session = requests.Session()
    
    # Test data
    email = "debug-revoke@example.com"
    order_id = "DEBUG-REVOKE-123"
    
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
        return
    
    key = claim_response.json().get('key')
    print(f"Got key: {key}")
    
    print("\n=== Step 3: Validate Key (Before Revoke) ===")
    validate_response = session.post(f"{API_BASE}/premium/keys/validate", json={"key": key})
    print(f"Validate before: {validate_response.status_code} - {validate_response.json()}")
    
    print("\n=== Step 4: Revoke via Refund Webhook ===")
    refund_payload = {
        "event": "Pagamento Reembolsado",
        "order_id": order_id,  # Same order_id
        "product_code": "C55E28191",
        "customer": {"email": email}  # Same email
    }
    
    revoke_response = session.post(f"{API_BASE}/webhooks/lastlink", headers=headers, json=refund_payload)
    print(f"Refund webhook: {revoke_response.status_code} - {revoke_response.json()}")
    
    print("\n=== Step 5: Validate Key (After Revoke) ===")
    validate_after = session.post(f"{API_BASE}/premium/keys/validate", json={"key": key})
    print(f"Validate after: {validate_after.status_code} - {validate_after.json()}")
    
    # Let's also test with just email-based revocation
    print("\n=== Step 6: Test Email-Only Revocation ===")
    
    # Create another purchase
    email2 = "debug-revoke2@example.com"
    order_id2 = "DEBUG-REVOKE-456"
    
    purchase_payload2 = {
        "event": "Compra Completa",
        "order_id": order_id2,
        "product_code": "C55E28191",
        "customer": {"email": email2}
    }
    
    response2 = session.post(f"{API_BASE}/webhooks/lastlink", headers=headers, json=purchase_payload2)
    print(f"Purchase 2 webhook: {response2.status_code} - {response2.json()}")
    
    claim_response2 = session.post(f"{API_BASE}/premium/claim", json={"email": email2})
    print(f"Claim 2: {claim_response2.status_code} - {claim_response2.json()}")
    
    if claim_response2.status_code == 200:
        key2 = claim_response2.json().get('key')
        print(f"Got key 2: {key2}")
        
        # Revoke with different order_id but same email
        refund_payload2 = {
            "event": "Pagamento Reembolsado",
            "order_id": "DIFFERENT-ORDER-789",  # Different order_id
            "product_code": "C55E28191",
            "customer": {"email": email2}  # Same email
        }
        
        revoke_response2 = session.post(f"{API_BASE}/webhooks/lastlink", headers=headers, json=refund_payload2)
        print(f"Refund 2 webhook: {revoke_response2.status_code} - {revoke_response2.json()}")
        
        validate_after2 = session.post(f"{API_BASE}/premium/keys/validate", json={"key": key2})
        print(f"Validate 2 after: {validate_after2.status_code} - {validate_after2.json()}")

if __name__ == "__main__":
    debug_revocation()