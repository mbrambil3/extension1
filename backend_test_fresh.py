#!/usr/bin/env python3
"""
Fresh Backend API Testing with unique identifiers to avoid idempotency issues
"""

import requests
import json
import time
import uuid
from typing import Dict, Any, Optional
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv('/app/frontend/.env')

# Configuration
BASE_URL = os.getenv('REACT_APP_BACKEND_URL', 'https://pdf-reader-plus.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"
WEBHOOK_SECRET = "0e8cafc1171045df9b30c23db25a53df"

class FreshBackendTester:
    def __init__(self):
        self.session = requests.Session()
        self.test_results = []
        self.test_id = str(uuid.uuid4())[:8]  # Unique test session ID
        
    def log_result(self, test_name: str, success: bool, details: str = ""):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        result = f"{status} {test_name}"
        if details:
            result += f" - {details}"
        print(result)
        self.test_results.append({
            'test': test_name,
            'success': success,
            'details': details
        })
    
    def get_unique_id(self, prefix: str) -> str:
        """Generate unique ID for test"""
        return f"{prefix}-{self.test_id}-{int(time.time())}"
    
    def test_webhook_purchase_complete(self) -> bool:
        """Test webhook for complete purchase event"""
        print("\n=== Testing Webhook Purchase Complete ===")
        
        headers = {
            'Authorization': f'Bearer {WEBHOOK_SECRET}',
            'Content-Type': 'application/json'
        }
        
        unique_id = self.get_unique_id("PURCHASE")
        payload = {
            "event": "Compra Completa",
            "id": unique_id,  # Unique event ID
            "order_id": unique_id,
            "product_code": "C55E28191",
            "customer": {"email": f"test-{unique_id.lower()}@example.com"}
        }
        
        try:
            response = self.session.post(
                f"{API_BASE}/webhooks/lastlink",
                headers=headers,
                json=payload,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                success = data.get('received') and data.get('processed')
                self.log_result("Webhook Purchase Complete", success, f"Response: {data}")
                return success
            else:
                self.log_result("Webhook Purchase Complete", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Webhook Purchase Complete", False, f"Exception: {str(e)}")
            return False
    
    def test_webhook_refund(self) -> bool:
        """Test webhook for refund event"""
        print("\n=== Testing Webhook Refund ===")
        
        headers = {
            'Authorization': f'Bearer {WEBHOOK_SECRET}',
            'Content-Type': 'application/json'
        }
        
        unique_id = self.get_unique_id("REFUND")
        payload = {
            "event": "Pagamento Reembolsado",
            "id": unique_id,  # Unique event ID
            "order_id": unique_id,
            "product_code": "C55E28191",
            "customer": {"email": f"test-{unique_id.lower()}@example.com"}
        }
        
        try:
            response = self.session.post(
                f"{API_BASE}/webhooks/lastlink",
                headers=headers,
                json=payload,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                success = data.get('received') and data.get('processed')
                self.log_result("Webhook Refund", success, f"Response: {data}")
                return success
            else:
                self.log_result("Webhook Refund", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Webhook Refund", False, f"Exception: {str(e)}")
            return False
    
    def test_webhook_auth_invalid(self) -> bool:
        """Test webhook with invalid authentication"""
        print("\n=== Testing Webhook Invalid Auth ===")
        
        headers = {
            'Authorization': 'Bearer invalid-secret',
            'Content-Type': 'application/json'
        }
        
        unique_id = self.get_unique_id("INVALID")
        payload = {
            "event": "Compra Completa",
            "id": unique_id,
            "order_id": unique_id,
            "customer": {"email": f"test-{unique_id.lower()}@example.com"}
        }
        
        try:
            response = self.session.post(
                f"{API_BASE}/webhooks/lastlink",
                headers=headers,
                json=payload,
                timeout=10
            )
            
            # Should return 401 for invalid auth
            success = response.status_code == 401
            self.log_result("Webhook Invalid Auth", success, f"Status: {response.status_code} (expected 401)")
            return success
                
        except Exception as e:
            self.log_result("Webhook Invalid Auth", False, f"Exception: {str(e)}")
            return False
    
    def test_webhook_idempotency(self) -> bool:
        """Test webhook idempotency - same payload twice"""
        print("\n=== Testing Webhook Idempotency ===")
        
        headers = {
            'Authorization': f'Bearer {WEBHOOK_SECRET}',
            'Content-Type': 'application/json'
        }
        
        unique_id = self.get_unique_id("IDEMPOTENT")
        payload = {
            "event": "Compra Completa",
            "id": unique_id,  # Same ID for both calls
            "order_id": unique_id,
            "product_code": "C55E28191",
            "customer": {"email": f"test-{unique_id.lower()}@example.com"}
        }
        
        try:
            # First call
            response1 = self.session.post(
                f"{API_BASE}/webhooks/lastlink",
                headers=headers,
                json=payload,
                timeout=10
            )
            
            if response1.status_code != 200:
                self.log_result("Webhook Idempotency", False, f"First call failed: {response1.status_code}")
                return False
            
            data1 = response1.json()
            if not (data1.get('received') and data1.get('processed')):
                self.log_result("Webhook Idempotency", False, f"First call not processed: {data1}")
                return False
            
            # Second call (should be idempotent)
            response2 = self.session.post(
                f"{API_BASE}/webhooks/lastlink",
                headers=headers,
                json=payload,
                timeout=10
            )
            
            if response2.status_code != 200:
                self.log_result("Webhook Idempotency", False, f"Second call failed: {response2.status_code}")
                return False
            
            data2 = response2.json()
            success = (data2.get('received') and 
                      not data2.get('processed') and 
                      data2.get('idempotent'))
            
            self.log_result("Webhook Idempotency", success, 
                          f"First: {data1}, Second: {data2}")
            return success
                
        except Exception as e:
            self.log_result("Webhook Idempotency", False, f"Exception: {str(e)}")
            return False
    
    def test_premium_claim_and_validate(self) -> bool:
        """Test complete flow: purchase -> claim -> validate"""
        print("\n=== Testing Premium Complete Flow ===")
        
        headers = {
            'Authorization': f'Bearer {WEBHOOK_SECRET}',
            'Content-Type': 'application/json'
        }
        
        unique_id = self.get_unique_id("FLOW")
        email = f"test-{unique_id.lower()}@example.com"
        
        try:
            # Step 1: Create purchase
            purchase_payload = {
                "event": "Compra Completa",
                "id": unique_id,
                "order_id": unique_id,
                "product_code": "C55E28191",
                "customer": {"email": email}
            }
            
            webhook_response = self.session.post(
                f"{API_BASE}/webhooks/lastlink",
                headers=headers,
                json=purchase_payload,
                timeout=10
            )
            
            if webhook_response.status_code != 200:
                self.log_result("Premium Complete Flow", False, f"Webhook failed: {webhook_response.status_code}")
                return False
            
            webhook_data = webhook_response.json()
            if not (webhook_data.get('received') and webhook_data.get('processed')):
                self.log_result("Premium Complete Flow", False, f"Webhook not processed: {webhook_data}")
                return False
            
            # Step 2: Claim key
            claim_response = self.session.post(
                f"{API_BASE}/premium/claim",
                json={"email": email},
                timeout=10
            )
            
            if claim_response.status_code != 200:
                self.log_result("Premium Complete Flow", False, f"Claim failed: {claim_response.status_code}")
                return False
            
            claim_data = claim_response.json()
            key = claim_data.get('key')
            if not key or claim_data.get('status') != 'active':
                self.log_result("Premium Complete Flow", False, f"Invalid claim response: {claim_data}")
                return False
            
            # Step 3: Validate key
            validate_response = self.session.post(
                f"{API_BASE}/premium/keys/validate",
                json={"key": key},
                timeout=10
            )
            
            if validate_response.status_code != 200:
                self.log_result("Premium Complete Flow", False, f"Validate failed: {validate_response.status_code}")
                return False
            
            validate_data = validate_response.json()
            success = (validate_data.get('valid') and 
                      validate_data.get('plan') == 'premium' and 
                      validate_data.get('status') == 'active')
            
            self.log_result("Premium Complete Flow", success, 
                          f"Key: {key}, Validation: {validate_data}")
            return success
                
        except Exception as e:
            self.log_result("Premium Complete Flow", False, f"Exception: {str(e)}")
            return False
    
    def test_key_revocation_flow(self) -> bool:
        """Test complete revocation flow: purchase -> claim -> revoke -> validate"""
        print("\n=== Testing Key Revocation Flow ===")
        
        headers = {
            'Authorization': f'Bearer {WEBHOOK_SECRET}',
            'Content-Type': 'application/json'
        }
        
        unique_id = self.get_unique_id("REVOKE")
        email = f"test-{unique_id.lower()}@example.com"
        
        try:
            # Step 1: Create purchase
            purchase_payload = {
                "event": "Compra Completa",
                "id": f"{unique_id}-PURCHASE",
                "order_id": unique_id,
                "product_code": "C55E28191",
                "customer": {"email": email}
            }
            
            webhook_response = self.session.post(
                f"{API_BASE}/webhooks/lastlink",
                headers=headers,
                json=purchase_payload,
                timeout=10
            )
            
            if webhook_response.status_code != 200:
                self.log_result("Key Revocation Flow", False, f"Purchase webhook failed: {webhook_response.status_code}")
                return False
            
            # Step 2: Claim key
            claim_response = self.session.post(
                f"{API_BASE}/premium/claim",
                json={"email": email},
                timeout=10
            )
            
            if claim_response.status_code != 200:
                self.log_result("Key Revocation Flow", False, f"Claim failed: {claim_response.status_code}")
                return False
            
            key = claim_response.json().get('key')
            if not key:
                self.log_result("Key Revocation Flow", False, "No key returned")
                return False
            
            # Step 3: Revoke via refund
            refund_payload = {
                "event": "Pagamento Reembolsado",
                "id": f"{unique_id}-REFUND",  # Different event ID
                "order_id": unique_id,  # Same order_id for proper revocation
                "product_code": "C55E28191",
                "customer": {"email": email}
            }
            
            revoke_response = self.session.post(
                f"{API_BASE}/webhooks/lastlink",
                headers=headers,
                json=refund_payload,
                timeout=10
            )
            
            if revoke_response.status_code != 200:
                self.log_result("Key Revocation Flow", False, f"Revoke webhook failed: {revoke_response.status_code}")
                return False
            
            # Step 4: Validate revoked key
            validate_response = self.session.post(
                f"{API_BASE}/premium/keys/validate",
                json={"key": key},
                timeout=10
            )
            
            if validate_response.status_code != 200:
                self.log_result("Key Revocation Flow", False, f"Validate failed: {validate_response.status_code}")
                return False
            
            validate_data = validate_response.json()
            success = (not validate_data.get('valid') and 
                      validate_data.get('plan') == 'free' and 
                      validate_data.get('status') == 'revoked')
            
            self.log_result("Key Revocation Flow", success, 
                          f"Key: {key}, Validation: {validate_data}")
            return success
                
        except Exception as e:
            self.log_result("Key Revocation Flow", False, f"Exception: {str(e)}")
            return False
    
    def test_premium_claim_invalid(self) -> bool:
        """Test claiming premium key for non-existent purchase"""
        print("\n=== Testing Premium Claim (Invalid) ===")
        
        unique_id = self.get_unique_id("INVALID")
        claim_payload = {"email": f"nonexistent-{unique_id.lower()}@example.com"}
        
        try:
            response = self.session.post(
                f"{API_BASE}/premium/claim",
                json=claim_payload,
                timeout=10
            )
            
            # Should return 404 for non-existent purchase
            success = response.status_code == 404
            self.log_result("Premium Claim Invalid", success, f"Status: {response.status_code} (expected 404)")
            return success
                
        except Exception as e:
            self.log_result("Premium Claim Invalid", False, f"Exception: {str(e)}")
            return False
    
    def test_key_validation_invalid(self) -> bool:
        """Test validating an invalid/non-existent key"""
        print("\n=== Testing Key Validation (Invalid) ===")
        
        try:
            response = self.session.post(
                f"{API_BASE}/premium/keys/validate",
                json={"key": f"INVALID-KEY-{self.test_id}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                success = (not data.get('valid') and 
                          data.get('plan') == 'free' and 
                          data.get('status') == 'not_found')
                self.log_result("Key Validation Invalid", success, f"Response: {data}")
                return success
            else:
                self.log_result("Key Validation Invalid", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Key Validation Invalid", False, f"Exception: {str(e)}")
            return False
    
    def run_all_tests(self):
        """Run all backend tests"""
        print(f"🚀 Starting Fresh Backend API Tests")
        print(f"📍 Base URL: {API_BASE}")
        print(f"🔐 Webhook Secret: {WEBHOOK_SECRET[:8]}...")
        print(f"🆔 Test Session ID: {self.test_id}")
        print("=" * 60)
        
        # Core webhook tests
        self.test_webhook_purchase_complete()
        self.test_webhook_refund()
        self.test_webhook_auth_invalid()
        self.test_webhook_idempotency()
        
        # Premium flow tests
        self.test_premium_claim_and_validate()
        self.test_key_revocation_flow()
        self.test_premium_claim_invalid()
        self.test_key_validation_invalid()
        
        # Summary
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for r in self.test_results if r['success'])
        total = len(self.test_results)
        
        for result in self.test_results:
            status = "✅" if result['success'] else "❌"
            print(f"{status} {result['test']}")
            if not result['success'] and result['details']:
                print(f"   └─ {result['details']}")
        
        print(f"\n🎯 Results: {passed}/{total} tests passed")
        
        if passed == total:
            print("🎉 All tests passed!")
            return True
        else:
            print(f"⚠️  {total - passed} tests failed")
            return False

if __name__ == "__main__":
    tester = FreshBackendTester()
    success = tester.run_all_tests()
    exit(0 if success else 1)