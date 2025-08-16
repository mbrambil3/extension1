#!/usr/bin/env python3
"""
Chrome Extension Popup Functionality Test
Validates the two main popup actions without running the actual extension:
1. generateSummaryNow function
2. openHistoryWindow function
"""

import json
import re
from typing import Dict, List, Any, Optional

class ChromeExtensionValidator:
    def __init__(self):
        self.popup_js_content = ""
        self.content_js_content = ""
        self.history_html_content = ""
        self.history_js_content = ""
        self.manifest_content = ""
        
    def load_extension_files(self):
        """Load all Chrome extension files for analysis"""
        try:
            with open('/app/chrome-extension/popup.js', 'r', encoding='utf-8') as f:
                self.popup_js_content = f.read()
            
            with open('/app/chrome-extension/content.js', 'r', encoding='utf-8') as f:
                self.content_js_content = f.read()
                
            with open('/app/chrome-extension/history.html', 'r', encoding='utf-8') as f:
                self.history_html_content = f.read()
                
            with open('/app/chrome-extension/history.js', 'r', encoding='utf-8') as f:
                self.history_js_content = f.read()
                
            with open('/app/chrome-extension/manifest.json', 'r', encoding='utf-8') as f:
                self.manifest_content = f.read()
                
            return True
        except Exception as e:
            print(f"❌ Erro ao carregar arquivos da extensão: {e}")
            return False

    def validate_generate_summary_now(self) -> Dict[str, Any]:
        """
        Validate generateSummaryNow function in popup.js:
        - Should use chrome.tabs.query and chrome.tabs.sendMessage
        - Should send {action:'generateSummary', manual:true} to content script
        """
        results = {
            "function_exists": False,
            "uses_chrome_tabs_query": False,
            "uses_chrome_tabs_sendMessage": False,
            "sends_correct_message": False,
            "handles_response": False,
            "error_handling": False,
            "issues": []
        }
        
        # Check if function exists
        if "function generateSummaryNow()" in self.popup_js_content:
            results["function_exists"] = True
        else:
            results["issues"].append("Função generateSummaryNow não encontrada")
            
        # Check chrome.tabs.query usage
        if "chrome.tabs.query" in self.popup_js_content:
            results["uses_chrome_tabs_query"] = True
            # Check specific pattern
            if "chrome.tabs.query({ active: true, currentWindow: true }" in self.popup_js_content:
                results["uses_chrome_tabs_query"] = True
            else:
                results["issues"].append("chrome.tabs.query não usa parâmetros corretos (active: true, currentWindow: true)")
        else:
            results["issues"].append("chrome.tabs.query não encontrado na função")
            
        # Check chrome.tabs.sendMessage usage
        if "chrome.tabs.sendMessage" in self.popup_js_content:
            results["uses_chrome_tabs_sendMessage"] = True
        else:
            results["issues"].append("chrome.tabs.sendMessage não encontrado na função")
            
        # Check correct message format
        message_pattern = r"chrome\.tabs\.sendMessage\([^,]+,\s*{\s*action:\s*['\"]generateSummary['\"],\s*manual:\s*true\s*}"
        if re.search(message_pattern, self.popup_js_content):
            results["sends_correct_message"] = True
        else:
            results["issues"].append("Mensagem não está no formato correto: {action:'generateSummary', manual:true}")
            
        # Check response handling
        if "response" in self.popup_js_content and "started" in self.popup_js_content:
            results["handles_response"] = True
        else:
            results["issues"].append("Não trata adequadamente a resposta do content script")
            
        # Check error handling
        if "chrome.runtime.lastError" in self.popup_js_content:
            results["error_handling"] = True
        else:
            results["issues"].append("Não trata chrome.runtime.lastError")
            
        return results

    def validate_content_script_listener(self) -> Dict[str, Any]:
        """
        Validate content.js has listener for 'generateSummary' action:
        - Should respond with {started:true} when can start
        - Should respond with {started:false, errorMessage:...} for PDF viewer
        """
        results = {
            "has_message_listener": False,
            "handles_generate_summary": False,
            "uses_quick_can_start": False,
            "returns_started_true": False,
            "returns_started_false_with_error": False,
            "handles_manual_flag": False,
            "issues": []
        }
        
        # Check message listener
        if "chrome.runtime.onMessage.addListener" in self.content_js_content:
            results["has_message_listener"] = True
        else:
            results["issues"].append("chrome.runtime.onMessage.addListener não encontrado")
            
        # Check generateSummary action handling
        if 'message.action === "generateSummary"' in self.content_js_content:
            results["handles_generate_summary"] = True
        else:
            results["issues"].append("Não trata action 'generateSummary'")
            
        # Check quickCanStartExtraction usage
        if "quickCanStartExtraction" in self.content_js_content:
            results["uses_quick_can_start"] = True
        else:
            results["issues"].append("Não usa quickCanStartExtraction para validar se pode iniciar")
            
        # Check response patterns
        if "started: true" in self.content_js_content:
            results["returns_started_true"] = True
        else:
            results["issues"].append("Não retorna started: true em cenário normal")
            
        if "started: false" in self.content_js_content and "errorMessage" in self.content_js_content:
            results["returns_started_false_with_error"] = True
        else:
            results["issues"].append("Não retorna started: false com errorMessage para PDF viewer")
            
        # Check manual flag handling
        if "message.manual" in self.content_js_content:
            results["handles_manual_flag"] = True
        else:
            results["issues"].append("Não trata flag manual da mensagem")
            
        return results

    def validate_open_history_window(self) -> Dict[str, Any]:
        """
        Validate openHistoryWindow function in popup.js:
        - Should use chrome.runtime.getURL('history.html')
        - Should use chrome.tabs.create with the URL
        - Should have fallback to window.open
        """
        results = {
            "function_exists": False,
            "uses_chrome_runtime_getURL": False,
            "uses_chrome_tabs_create": False,
            "has_window_open_fallback": False,
            "correct_history_html_path": False,
            "error_handling": False,
            "issues": []
        }
        
        # Check if function exists
        if "function openHistoryWindow()" in self.popup_js_content:
            results["function_exists"] = True
        else:
            results["issues"].append("Função openHistoryWindow não encontrada")
            
        # Check chrome.runtime.getURL usage
        if "chrome.runtime.getURL" in self.popup_js_content:
            results["uses_chrome_runtime_getURL"] = True
            if "chrome.runtime.getURL('history.html')" in self.popup_js_content:
                results["correct_history_html_path"] = True
            else:
                results["issues"].append("chrome.runtime.getURL não usa 'history.html' como parâmetro")
        else:
            results["issues"].append("chrome.runtime.getURL não encontrado na função")
            
        # Check chrome.tabs.create usage
        if "chrome.tabs.create" in self.popup_js_content:
            results["uses_chrome_tabs_create"] = True
        else:
            results["issues"].append("chrome.tabs.create não encontrado na função")
            
        # Check window.open fallback
        if "window.open" in self.popup_js_content:
            results["has_window_open_fallback"] = True
        else:
            results["issues"].append("Não tem fallback window.open")
            
        # Check error handling
        if "try" in self.popup_js_content and "catch" in self.popup_js_content:
            results["error_handling"] = True
        else:
            results["issues"].append("Não tem tratamento de erro adequado")
            
        return results

    def validate_history_html_structure(self) -> Dict[str, Any]:
        """
        Validate history.html includes history.js and has proper structure
        """
        results = {
            "includes_history_js": False,
            "has_proper_structure": False,
            "has_history_list_element": False,
            "has_empty_state": False,
            "issues": []
        }
        
        # Check if includes history.js
        if 'src="history.js"' in self.history_html_content:
            results["includes_history_js"] = True
        else:
            results["issues"].append("history.html não inclui history.js")
            
        # Check basic structure
        if '<div id="historyList"' in self.history_html_content:
            results["has_history_list_element"] = True
        else:
            results["issues"].append("Não tem elemento historyList")
            
        if '<div id="emptyState"' in self.history_html_content:
            results["has_empty_state"] = True
        else:
            results["issues"].append("Não tem elemento emptyState")
            
        if results["includes_history_js"] and results["has_history_list_element"]:
            results["has_proper_structure"] = True
            
        return results

    def validate_history_js_initialization(self) -> Dict[str, Any]:
        """
        Validate history.js calls chrome.runtime.sendMessage({action:'getHistory'}) on load
        """
        results = {
            "has_dom_content_loaded": False,
            "calls_load_history": False,
            "sends_get_history_message": False,
            "handles_response": False,
            "shows_empty_state": False,
            "issues": []
        }
        
        # Check DOMContentLoaded listener
        if "DOMContentLoaded" in self.history_js_content:
            results["has_dom_content_loaded"] = True
        else:
            results["issues"].append("Não tem listener para DOMContentLoaded")
            
        # Check loadHistory function call
        if "loadHistory()" in self.history_js_content:
            results["calls_load_history"] = True
        else:
            results["issues"].append("Não chama loadHistory() na inicialização")
            
        # Check getHistory message
        if 'action: "getHistory"' in self.history_js_content:
            results["sends_get_history_message"] = True
        else:
            results["issues"].append("Não envia mensagem {action:'getHistory'}")
            
        # Check response handling
        if "response.history" in self.history_js_content:
            results["handles_response"] = True
        else:
            results["issues"].append("Não trata adequadamente a resposta do getHistory")
            
        # Check empty state
        if "showEmptyState" in self.history_js_content:
            results["shows_empty_state"] = True
        else:
            results["issues"].append("Não tem função showEmptyState")
            
        return results

    def validate_manifest_permissions(self) -> Dict[str, Any]:
        """
        Validate manifest.json has required permissions
        """
        results = {
            "has_active_tab": False,
            "has_storage": False,
            "has_scripting": False,
            "history_html_accessible": False,
            "issues": []
        }
        
        try:
            manifest = json.loads(self.manifest_content)
            
            permissions = manifest.get("permissions", [])
            if "activeTab" in permissions:
                results["has_active_tab"] = True
            else:
                results["issues"].append("Permissão 'activeTab' não encontrada")
                
            if "storage" in permissions:
                results["has_storage"] = True
            else:
                results["issues"].append("Permissão 'storage' não encontrada")
                
            if "scripting" in permissions:
                results["has_scripting"] = True
            else:
                results["issues"].append("Permissão 'scripting' não encontrada")
                
            # Check web accessible resources
            web_resources = manifest.get("web_accessible_resources", [])
            for resource_group in web_resources:
                if "history.html" in resource_group.get("resources", []):
                    results["history_html_accessible"] = True
                    break
            
            if not results["history_html_accessible"]:
                results["issues"].append("history.html não está em web_accessible_resources")
                
        except json.JSONDecodeError as e:
            results["issues"].append(f"Erro ao parsear manifest.json: {e}")
            
        return results

    def simulate_scenarios(self) -> Dict[str, Any]:
        """
        Simulate different scenarios to validate behavior
        """
        scenarios = {
            "normal_page_scenario": {
                "description": "Página normal - deve retornar started: true",
                "expected_content_response": {"started": True},
                "validation": "quickCanStartExtraction retorna canStart=true"
            },
            "pdf_viewer_scenario": {
                "description": "PDF no viewer nativo - deve retornar started: false com errorMessage",
                "expected_content_response": {"started": False, "errorMessage": "PDF detectado. Use o botão 'Gerar Resumo Agora' no popup."},
                "validation": "quickCanStartExtraction retorna canStart=false"
            },
            "insufficient_content_scenario": {
                "description": "Conteúdo insuficiente - deve retornar started: false",
                "expected_content_response": {"started": False, "errorMessage": "Conteúdo insuficiente"},
                "validation": "Menos de 300 caracteres de conteúdo"
            }
        }
        
        # Validate quickCanStartExtraction logic
        quick_can_start_logic = {
            "detects_pdf_url": "/.pdf($|?|#)/i.test(url)" in self.content_js_content,
            "detects_pdf_embed": 'document.querySelector(\'embed[type="application/pdf"]\')' in self.content_js_content,
            "returns_can_start_false_for_pdf": "canStart: false" in self.content_js_content,
            "provides_pdf_error_message": "PDF detectado" in self.content_js_content
        }
        
        return {
            "scenarios": scenarios,
            "quick_can_start_logic": quick_can_start_logic
        }

    def run_comprehensive_test(self) -> Dict[str, Any]:
        """Run all validation tests"""
        print("🔍 Iniciando validação da extensão Chrome...")
        
        if not self.load_extension_files():
            return {"success": False, "error": "Falha ao carregar arquivos da extensão"}
        
        results = {
            "generate_summary_now": self.validate_generate_summary_now(),
            "content_script_listener": self.validate_content_script_listener(),
            "open_history_window": self.validate_open_history_window(),
            "history_html_structure": self.validate_history_html_structure(),
            "history_js_initialization": self.validate_history_js_initialization(),
            "manifest_permissions": self.validate_manifest_permissions(),
            "scenarios": self.simulate_scenarios()
        }
        
        return results

def print_test_results(results: Dict[str, Any]):
    """Print formatted test results"""
    print("\n" + "="*80)
    print("📋 RELATÓRIO DE VALIDAÇÃO DA EXTENSÃO CHROME")
    print("="*80)
    
    # Generate Summary Now
    print("\n🎯 1. FUNÇÃO generateSummaryNow (popup.js)")
    gsn = results["generate_summary_now"]
    print(f"   ✅ Função existe: {gsn['function_exists']}")
    print(f"   ✅ Usa chrome.tabs.query: {gsn['uses_chrome_tabs_query']}")
    print(f"   ✅ Usa chrome.tabs.sendMessage: {gsn['uses_chrome_tabs_sendMessage']}")
    print(f"   ✅ Envia mensagem correta: {gsn['sends_correct_message']}")
    print(f"   ✅ Trata resposta: {gsn['handles_response']}")
    print(f"   ✅ Trata erros: {gsn['error_handling']}")
    if gsn['issues']:
        print("   ⚠️  Problemas encontrados:")
        for issue in gsn['issues']:
            print(f"      - {issue}")
    
    # Content Script Listener
    print("\n📡 2. LISTENER DO CONTENT SCRIPT (content.js)")
    csl = results["content_script_listener"]
    print(f"   ✅ Tem message listener: {csl['has_message_listener']}")
    print(f"   ✅ Trata 'generateSummary': {csl['handles_generate_summary']}")
    print(f"   ✅ Usa quickCanStartExtraction: {csl['uses_quick_can_start']}")
    print(f"   ✅ Retorna started: true: {csl['returns_started_true']}")
    print(f"   ✅ Retorna started: false + error: {csl['returns_started_false_with_error']}")
    print(f"   ✅ Trata flag manual: {csl['handles_manual_flag']}")
    if csl['issues']:
        print("   ⚠️  Problemas encontrados:")
        for issue in csl['issues']:
            print(f"      - {issue}")
    
    # Open History Window
    print("\n📚 3. FUNÇÃO openHistoryWindow (popup.js)")
    ohw = results["open_history_window"]
    print(f"   ✅ Função existe: {ohw['function_exists']}")
    print(f"   ✅ Usa chrome.runtime.getURL: {ohw['uses_chrome_runtime_getURL']}")
    print(f"   ✅ Usa chrome.tabs.create: {ohw['uses_chrome_tabs_create']}")
    print(f"   ✅ Tem fallback window.open: {ohw['has_window_open_fallback']}")
    print(f"   ✅ Caminho correto history.html: {ohw['correct_history_html_path']}")
    print(f"   ✅ Trata erros: {ohw['error_handling']}")
    if ohw['issues']:
        print("   ⚠️  Problemas encontrados:")
        for issue in ohw['issues']:
            print(f"      - {issue}")
    
    # History HTML Structure
    print("\n🏗️  4. ESTRUTURA DO HISTORY.HTML")
    hhs = results["history_html_structure"]
    print(f"   ✅ Inclui history.js: {hhs['includes_history_js']}")
    print(f"   ✅ Tem estrutura adequada: {hhs['has_proper_structure']}")
    print(f"   ✅ Tem elemento historyList: {hhs['has_history_list_element']}")
    print(f"   ✅ Tem estado vazio: {hhs['has_empty_state']}")
    if hhs['issues']:
        print("   ⚠️  Problemas encontrados:")
        for issue in hhs['issues']:
            print(f"      - {issue}")
    
    # History JS Initialization
    print("\n🚀 5. INICIALIZAÇÃO DO HISTORY.JS")
    hji = results["history_js_initialization"]
    print(f"   ✅ Tem DOMContentLoaded: {hji['has_dom_content_loaded']}")
    print(f"   ✅ Chama loadHistory: {hji['calls_load_history']}")
    print(f"   ✅ Envia getHistory: {hji['sends_get_history_message']}")
    print(f"   ✅ Trata resposta: {hji['handles_response']}")
    print(f"   ✅ Mostra estado vazio: {hji['shows_empty_state']}")
    if hji['issues']:
        print("   ⚠️  Problemas encontrados:")
        for issue in hji['issues']:
            print(f"      - {issue}")
    
    # Manifest Permissions
    print("\n🔐 6. PERMISSÕES DO MANIFEST.JSON")
    mp = results["manifest_permissions"]
    print(f"   ✅ Tem activeTab: {mp['has_active_tab']}")
    print(f"   ✅ Tem storage: {mp['has_storage']}")
    print(f"   ✅ Tem scripting: {mp['has_scripting']}")
    print(f"   ✅ history.html acessível: {mp['history_html_accessible']}")
    if mp['issues']:
        print("   ⚠️  Problemas encontrados:")
        for issue in mp['issues']:
            print(f"      - {issue}")
    
    # Scenarios
    print("\n🎭 7. CENÁRIOS DE TESTE")
    scenarios = results["scenarios"]
    qcsl = scenarios["quick_can_start_logic"]
    print(f"   ✅ Detecta URL PDF: {qcsl['detects_pdf_url']}")
    print(f"   ✅ Detecta embed PDF: {qcsl['detects_pdf_embed']}")
    print(f"   ✅ Retorna canStart=false para PDF: {qcsl['returns_can_start_false_for_pdf']}")
    print(f"   ✅ Fornece mensagem de erro PDF: {qcsl['provides_pdf_error_message']}")
    
    print("\n   📋 Cenários esperados:")
    for name, scenario in scenarios["scenarios"].items():
        print(f"      • {scenario['description']}")
        print(f"        Validação: {scenario['validation']}")
    
    # Overall Assessment
    print("\n" + "="*80)
    print("📊 AVALIAÇÃO GERAL")
    print("="*80)
    
    all_checks = []
    for section_name, section_results in results.items():
        if section_name == "scenarios":
            continue
        if isinstance(section_results, dict):
            for key, value in section_results.items():
                if key != "issues" and isinstance(value, bool):
                    all_checks.append(value)
    
    passed_checks = sum(all_checks)
    total_checks = len(all_checks)
    success_rate = (passed_checks / total_checks) * 100 if total_checks > 0 else 0
    
    print(f"✅ Verificações passaram: {passed_checks}/{total_checks} ({success_rate:.1f}%)")
    
    # Critical issues
    critical_issues = []
    for section_name, section_results in results.items():
        if isinstance(section_results, dict) and "issues" in section_results:
            critical_issues.extend(section_results["issues"])
    
    if critical_issues:
        print(f"⚠️  Total de problemas encontrados: {len(critical_issues)}")
        print("\n🔧 AÇÕES RECOMENDADAS:")
        for i, issue in enumerate(critical_issues, 1):
            print(f"   {i}. {issue}")
    else:
        print("🎉 Nenhum problema crítico encontrado!")
    
    return success_rate >= 80 and len(critical_issues) == 0

def main():
    """Main test execution"""
    validator = ChromeExtensionValidator()
    results = validator.run_comprehensive_test()
    
    if "error" in results:
        print(f"❌ Erro na validação: {results['error']}")
        return False
    
    success = print_test_results(results)
    
    print("\n" + "="*80)
    if success:
        print("🎉 VALIDAÇÃO CONCLUÍDA COM SUCESSO!")
        print("✅ Todos os fluxos estão implementados corretamente")
        print("✅ A extensão deve funcionar conforme especificado")
    else:
        print("⚠️  VALIDAÇÃO CONCLUÍDA COM PROBLEMAS")
        print("❌ Alguns fluxos precisam de correção antes do funcionamento adequado")
    print("="*80)
    
    return success

if __name__ == "__main__":
    main()