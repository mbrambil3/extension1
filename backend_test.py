#!/usr/bin/env python3
"""
Backend API Testing for Webhook and Premium Endpoints
Tests the new LastLink webhook integration and premium key management
"""

import requests
import json
import time
from typing import Dict, Any, Optional
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv('/app/frontend/.env')

# Configuration
BASE_URL = os.getenv('REACT_APP_BACKEND_URL', 'https://readwise-chrome.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"
WEBHOOK_SECRET = "0e8cafc1171045df9b30c23db25a53df"

# Test data
TEST_EMAIL = "comprador@example.com"
TEST_ORDER_ID = "ORD-123"
TEST_PRODUCT_CODE = "C55E28191"

class BackendTester:
    def __init__(self):
        self.session = requests.Session()
        self.test_results = []
        
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
        
    def test_webhook_auth_bearer(self) -> bool:
        """Test webhook authentication with Bearer token"""
        print("\n=== Testing Webhook Authentication (Bearer) ===")
        
        headers = {
            'Authorization': f'Bearer {WEBHOOK_SECRET}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            "event": "Compra Completa",
            "order_id": TEST_ORDER_ID,
            "product_code": TEST_PRODUCT_CODE,
            "customer": {"email": TEST_EMAIL}
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
                self.log_result("Webhook Auth Bearer", success, f"Status: {response.status_code}, Response: {data}")
                return success
            else:
                self.log_result("Webhook Auth Bearer", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Webhook Auth Bearer", False, f"Exception: {str(e)}")
            return False
    
    def test_webhook_auth_token_header(self) -> bool:
        """Test webhook authentication with X-Webhook-Token header"""
        print("\n=== Testing Webhook Authentication (X-Webhook-Token) ===")
        
        headers = {
            'X-Webhook-Token': WEBHOOK_SECRET,
            'Content-Type': 'application/json'
        }
        
        payload = {
            "event": "Compra Completa",
            "order_id": f"{TEST_ORDER_ID}-token",
            "product_code": TEST_PRODUCT_CODE,
            "customer": {"email": f"token-{TEST_EMAIL}"}
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
                self.log_result("Webhook Auth Token Header", success, f"Status: {response.status_code}, Response: {data}")
                return success
            else:
                self.log_result("Webhook Auth Token Header", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Webhook Auth Token Header", False, f"Exception: {str(e)}")
            return False
    
    def test_webhook_auth_invalid(self) -> bool:
        """Test webhook with invalid authentication"""
        print("\n=== Testing Webhook Invalid Auth ===")
        
        headers = {
            'Authorization': 'Bearer invalid-secret',
            'Content-Type': 'application/json'
        }
        
        payload = {
            "event": "Compra Completa",
            "order_id": "invalid-test",
            "customer": {"email": "invalid@example.com"}
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
    
    def test_webhook_purchase_complete(self) -> bool:
        """Test webhook for complete purchase event"""
        print("\n=== Testing Webhook Purchase Complete ===")
        
        headers = {
            'Authorization': f'Bearer {WEBHOOK_SECRET}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            "event": "Compra Completa",
            "order_id": f"{TEST_ORDER_ID}-purchase",
            "product_code": TEST_PRODUCT_CODE,
            "customer": {"email": f"purchase-{TEST_EMAIL}"}
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
        
        payload = {
            "event": "Pagamento Reembolsado",
            "order_id": f"{TEST_ORDER_ID}-refund",
            "product_code": TEST_PRODUCT_CODE,
            "customer": {"email": f"refund-{TEST_EMAIL}"}
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
    
    def test_webhook_chargeback(self) -> bool:
        """Test webhook for chargeback event"""
        print("\n=== Testing Webhook Chargeback ===")
        
        headers = {
            'Authorization': f'Bearer {WEBHOOK_SECRET}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            "event": "Pagamento Estornado",
            "order_id": f"{TEST_ORDER_ID}-chargeback",
            "product_code": TEST_PRODUCT_CODE,
            "customer": {"email": f"chargeback-{TEST_EMAIL}"}
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
                self.log_result("Webhook Chargeback", success, f"Response: {data}")
                return success
            else:
                self.log_result("Webhook Chargeback", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Webhook Chargeback", False, f"Exception: {str(e)}")
            return False
    
    def test_webhook_cancel(self) -> bool:
        """Test webhook for order cancellation event"""
        print("\n=== Testing Webhook Order Cancel ===")
        
        headers = {
            'Authorization': f'Bearer {WEBHOOK_SECRET}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            "event": "Pedido de Compra Cancelado",
            "order_id": f"{TEST_ORDER_ID}-cancel",
            "product_code": TEST_PRODUCT_CODE,
            "customer": {"email": f"cancel-{TEST_EMAIL}"}
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
                self.log_result("Webhook Order Cancel", success, f"Response: {data}")
                return success
            else:
                self.log_result("Webhook Order Cancel", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Webhook Order Cancel", False, f"Exception: {str(e)}")
            return False
    
    def test_webhook_idempotency(self) -> bool:
        """Test webhook idempotency - same payload twice"""
        print("\n=== Testing Webhook Idempotency ===")
        
        headers = {
            'Authorization': f'Bearer {WEBHOOK_SECRET}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            "event": "Compra Completa",
            "order_id": f"{TEST_ORDER_ID}-idempotent",
            "product_code": TEST_PRODUCT_CODE,
            "customer": {"email": f"idempotent-{TEST_EMAIL}"}
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
    
    def test_premium_claim_valid(self) -> bool:
        """Test claiming premium key after valid purchase"""
        print("\n=== Testing Premium Claim (Valid) ===")
        
        # First create a purchase via webhook
        headers = {
            'Authorization': f'Bearer {WEBHOOK_SECRET}',
            'Content-Type': 'application/json'
        }
        
        claim_email = f"claim-{TEST_EMAIL}"
        webhook_payload = {
            "event": "Compra Completa",
            "order_id": f"{TEST_ORDER_ID}-claim",
            "product_code": TEST_PRODUCT_CODE,
            "customer": {"email": claim_email}
        }
        
        try:
            # Create purchase
            webhook_response = self.session.post(
                f"{API_BASE}/webhooks/lastlink",
                headers=headers,
                json=webhook_payload,
                timeout=10
            )
            
            if webhook_response.status_code != 200:
                self.log_result("Premium Claim Valid", False, f"Webhook setup failed: {webhook_response.status_code}")
                return False
            
            # Now claim the key
            claim_payload = {"email": claim_email}
            claim_response = self.session.post(
                f"{API_BASE}/premium/claim",
                json=claim_payload,
                timeout=10
            )
            
            if claim_response.status_code == 200:
                data = claim_response.json()
                success = data.get('key') and data.get('status') == 'active'
                self.log_result("Premium Claim Valid", success, f"Response: {data}")
                return success
            else:
                self.log_result("Premium Claim Valid", False, f"Status: {claim_response.status_code}, Response: {claim_response.text}")
                return False
                
        except Exception as e:
            self.log_result("Premium Claim Valid", False, f"Exception: {str(e)}")
            return False
    
    def test_premium_claim_invalid(self) -> bool:
        """Test claiming premium key for non-existent purchase"""
        print("\n=== Testing Premium Claim (Invalid) ===")
        
        claim_payload = {"email": "nonexistent@example.com"}
        
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
    
    def test_key_validation_active(self) -> bool:
        """Test validating an active premium key"""
        print("\n=== Testing Key Validation (Active) ===")
        
        # First create a purchase and claim key
        headers = {
            'Authorization': f'Bearer {WEBHOOK_SECRET}',
            'Content-Type': 'application/json'
        }
        
        validate_email = f"validate-{TEST_EMAIL}"
        webhook_payload = {
            "event": "Compra Completa",
            "order_id": f"{TEST_ORDER_ID}-validate",
            "product_code": TEST_PRODUCT_CODE,
            "customer": {"email": validate_email}
        }
        
        try:
            # Create purchase
            webhook_response = self.session.post(
                f"{API_BASE}/webhooks/lastlink",
                headers=headers,
                json=webhook_payload,
                timeout=10
            )
            
            if webhook_response.status_code != 200:
                self.log_result("Key Validation Active", False, f"Webhook setup failed: {webhook_response.status_code}")
                return False
            
            # Claim key
            claim_response = self.session.post(
                f"{API_BASE}/premium/claim",
                json={"email": validate_email},
                timeout=10
            )
            
            if claim_response.status_code != 200:
                self.log_result("Key Validation Active", False, f"Claim failed: {claim_response.status_code}")
                return False
            
            key = claim_response.json().get('key')
            if not key:
                self.log_result("Key Validation Active", False, "No key returned from claim")
                return False
            
            # Validate key
            validate_response = self.session.post(
                f"{API_BASE}/premium/keys/validate",
                json={"key": key},
                timeout=10
            )
            
            if validate_response.status_code == 200:
                data = validate_response.json()
                success = (data.get('valid') and 
                          data.get('plan') == 'premium' and 
                          data.get('status') == 'active')
                self.log_result("Key Validation Active", success, f"Response: {data}")
                return success
            else:
                self.log_result("Key Validation Active", False, f"Status: {validate_response.status_code}, Response: {validate_response.text}")
                return False
                
        except Exception as e:
            self.log_result("Key Validation Active", False, f"Exception: {str(e)}")
            return False
    
    def test_key_validation_revoked(self) -> bool:
        """Test validating a revoked premium key"""
        print("\n=== Testing Key Validation (Revoked) ===")
        
        # First create a purchase and claim key
        headers = {
            'Authorization': f'Bearer {WEBHOOK_SECRET}',
            'Content-Type': 'application/json'
        }
        
        revoke_email = f"revoke-{TEST_EMAIL}"
        order_id = f"{TEST_ORDER_ID}-revoke"
        
        # Create purchase
        webhook_payload = {
            "event": "Compra Completa",
            "order_id": order_id,
            "product_code": TEST_PRODUCT_CODE,
            "customer": {"email": revoke_email}
        }
        
        try:
            # Create purchase
            webhook_response = self.session.post(
                f"{API_BASE}/webhooks/lastlink",
                headers=headers,
                json=webhook_payload,
                timeout=10
            )
            
            if webhook_response.status_code != 200:
                self.log_result("Key Validation Revoked", False, f"Webhook setup failed: {webhook_response.status_code}")
                return False
            
            # Claim key
            claim_response = self.session.post(
                f"{API_BASE}/premium/claim",
                json={"email": revoke_email},
                timeout=10
            )
            
            if claim_response.status_code != 200:
                self.log_result("Key Validation Revoked", False, f"Claim failed: {claim_response.status_code}")
                return False
            
            key = claim_response.json().get('key')
            if not key:
                self.log_result("Key Validation Revoked", False, "No key returned from claim")
                return False
            
            # Now revoke the key via refund webhook
            revoke_payload = {
                "event": "Pagamento Reembolsado",
                "order_id": order_id,
                "product_code": TEST_PRODUCT_CODE,
                "customer": {"email": revoke_email}
            }
            
            revoke_response = self.session.post(
                f"{API_BASE}/webhooks/lastlink",
                headers=headers,
                json=revoke_payload,
                timeout=10
            )
            
            if revoke_response.status_code != 200:
                self.log_result("Key Validation Revoked", False, f"Revoke webhook failed: {revoke_response.status_code}")
                return False
            
            # Validate key (should now be revoked)
            validate_response = self.session.post(
                f"{API_BASE}/premium/keys/validate",
                json={"key": key},
                timeout=10
            )
            
            if validate_response.status_code == 200:
                data = validate_response.json()
                success = (not data.get('valid') and 
                          data.get('plan') == 'free' and 
                          data.get('status') == 'revoked')
                self.log_result("Key Validation Revoked", success, f"Response: {data}")
                return success
            else:
                self.log_result("Key Validation Revoked", False, f"Status: {validate_response.status_code}, Response: {validate_response.text}")
                return False
                
        except Exception as e:
            self.log_result("Key Validation Revoked", False, f"Exception: {str(e)}")
            return False
    
    def test_key_validation_invalid(self) -> bool:
        """Test validating an invalid/non-existent key"""
        print("\n=== Testing Key Validation (Invalid) ===")
        
        try:
            response = self.session.post(
                f"{API_BASE}/premium/keys/validate",
                json={"key": "INVALID-KEY-1234"},
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
        print(f"🚀 Starting Backend API Tests")
        print(f"📍 Base URL: {API_BASE}")
        print(f"🔐 Webhook Secret: {WEBHOOK_SECRET[:8]}...")
        print("=" * 60)
        
        # Test webhook authentication
        self.test_webhook_auth_bearer()
        self.test_webhook_auth_token_header()
        self.test_webhook_auth_invalid()
        
        # Test webhook events
        self.test_webhook_purchase_complete()
        self.test_webhook_refund()
        self.test_webhook_chargeback()
        self.test_webhook_cancel()
        self.test_webhook_idempotency()
        
        # Test premium APIs
        self.test_premium_claim_valid()
        self.test_premium_claim_invalid()
        self.test_key_validation_active()
        self.test_key_validation_revoked()
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
    tester = BackendTester()
    success = tester.run_all_tests()
    exit(0 if success else 1)