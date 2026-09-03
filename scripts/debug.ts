import { AdaptiveCommunicationAnalyzer } from "../src/runtime/language/AdaptiveCommunicationAnalyzer";
let analyzer = ((AdaptiveCommunicationAnalyzer as any).instance = undefined);
analyzer = AdaptiveCommunicationAnalyzer.getInstance();
analyzer.clearSession();
analyzer.observe({ userText: "hello this is english", backendBehavior: null });
console.log(analyzer.getProfile().totalConversationsAnalyzed);
analyzer.clearSession();
analyzer.observe({ userText: "hello this is english", backendBehavior: null });
console.log(analyzer.getProfile().totalConversationsAnalyzed);
