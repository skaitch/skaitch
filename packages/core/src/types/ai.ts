import type { ItemsMap, ViewState2D } from './ifc.js';
/** Effort levels a user may pick; each provider receives the value as is and rejects what its model lacks. */
export const AI_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AiEffort = typeof AI_EFFORTS[number];
/** Empty or absent: the request carries no effort and the model keeps its own default. */
export const isAiEffort = (value: unknown): value is AiEffort | '' => value === '' || (AI_EFFORTS as readonly unknown[]).includes(value);
/** Levels to offer: those the provider reports, else all; the current choice always stays listed. */
export function effortChoices(reported: readonly AiEffort[] | undefined, current?: AiEffort | ''): AiEffort[] {
  const levels: AiEffort[] = reported?.length ? [...reported] : [...AI_EFFORTS];
  return current && !levels.includes(current) ? [...levels, current] : levels;
}
export interface ModelCapabilities {
  text: boolean; image: boolean; tools: boolean; thinking: boolean;
  /** Effort levels the provider reports for this model; absent when it does not say. */
  effort?: AiEffort[];
}
export interface AiMessage { role: 'assistant' | 'user' | 'tool'; content?: string }
export interface ToolUse { id: string; name: string; input: Record<string, unknown> }
export interface AiResult { text: string; toolUses: ToolUse[] }

export interface ConversationContext { items: ItemsMap; focusStorey: string; lang: string; selection: string[]; finalTxt: string; view2d?: ViewState2D }

export interface ConversationTurn { messages: AiMessage[]; round: number }
export interface ConversationResult extends AiResult { next: ConversationTurn | null }
