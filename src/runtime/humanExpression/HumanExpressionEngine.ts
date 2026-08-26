import { ConversationBlackboard } from "./ConversationBlackboard";
import { ConversationPresence } from "./ConversationPresence";
import { ConversationTemperature } from "./ConversationTemperature";
import { ConversationEnergy } from "./ConversationEnergy";
import { InitiativeEngine } from "./InitiativeEngine";
import { CuriosityEngine } from "./CuriosityEngine";
import { ThinkingStyleEngine } from "./ThinkingStyleEngine";
import { ListeningStyleEngine } from "./ListeningStyleEngine";
import { ExpressionTelemetry } from "./ExpressionTelemetry";

export class HumanExpressionEngine {
  private static instance: HumanExpressionEngine;
  private blackboard = new ConversationBlackboard();
  
  private presence = new ConversationPresence();
  private temperature = new ConversationTemperature();
  private energy = new ConversationEnergy();
  private initiative = new InitiativeEngine();
  private curiosity = new CuriosityEngine();
  private thinking = new ThinkingStyleEngine();
  private listening = new ListeningStyleEngine();

  private constructor() {}

  public static getInstance() {
    if (!this.instance) this.instance = new HumanExpressionEngine();
    return this.instance;
  }

  public evaluateExpression(userText: string, contextState: string, intent: string): string {
    const energyLevel = this.energy.evaluate(userText, contextState);
    const tempLevel = this.temperature.evaluate(userText, intent);
    const presLevel = this.presence.evaluate(contextState, energyLevel, tempLevel);
    
    this.blackboard.update({
      presence: presLevel,
      temperature: tempLevel,
      energy: energyLevel,
      initiative: this.initiative.evaluate(intent, contextState),
      curiosity: this.curiosity.evaluate(userText, intent),
      thinkingStyle: this.thinking.evaluate(contextState, userText),
      listeningStyle: this.listening.evaluate(userText, tempLevel)
    });

    const state = this.blackboard.getState();
    ExpressionTelemetry.getInstance().log(state);

    return this.formatExpressionBlock(state);
  }

  private formatExpressionBlock(state: any): string {
    return `
[HUMAN EXPRESSION ARCHITECTURE]
You are a single consistent human adapting naturally to the conversation, not an AI running templates.
Adopt the following expression state derived from the Conversation Blackboard:

- Presence: ${state.presence}
- Temperature: ${state.temperature} (Gradual tone adjustment)
- Energy: ${state.energy} (Determines pace and response size)
- Initiative: ${state.initiative} (Determines if you listen, share, or lead)
- Curiosity: ${state.curiosity} (If asking a question, make it originate from this level of depth)
- Thinking Style: ${state.thinkingStyle} (Determines your reasoning approach)
- Listening Style: ${state.listeningStyle} (What you are selectively paying attention to)

HUMAN VARIABILITY RULES:
- Do not optimize every response. Allow natural imperfection, minor reconsiderations, and pauses.
- Questions must originate from genuine curiosity based on the user's specifics, NEVER generic follow-ups.
- Maintain consistent habits (e.g. noticing contradictions or sharing perspectives) but adapt your energy smoothly.
- Avoid anti-patterns: Do not always validate, apologize, over-explain, or end with questions. Let silence exist when appropriate.
[/HUMAN EXPRESSION ARCHITECTURE]\n`;
  }
}
