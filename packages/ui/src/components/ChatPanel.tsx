import { findCredential, localAiEndpoint } from '@skaitch/core/lib/aiCredentialTarget';
import { detachToolImage } from '@skaitch/core/lib/detachToolImage';
import { TOOLS as MCP_TOOLS } from '@skaitch/core/mcp-tools';
import { fetchConversation, conversationIntent, adjustConversation, discoverModelCapabilities } from '../lib/aiService';
import { CHAT_SKILLS, CODE_MODE_TOOLS, searchChatTools, TOOL_HINTS } from '@skaitch/core/ai/tools';
export { getToolSchema } from '@skaitch/core/ai/tools';
import { runCodeMode } from '../lib/codeMode';
import { makeT } from '@skaitch/core/data/i18n';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatSlotProps } from '../platform';
import type { ItemsMap, IfcEntity, AiConfig, ViewState2D } from '@skaitch/core/types/ifc';


interface Props {
  catalogue: ChatSlotProps['catalogue'];
  open: boolean;
  onClose: () => void;
  items: ItemsMap;
  ai: AiConfig;
  selection: string[];
  setSelection: (ids: string[]) => void;
  addItem: (it: IfcEntity) => void;
  updateItem: (id: string, patch: Partial<IfcEntity>) => void;
  deleteItems: (ids: string[]) => void;
  injectIfc?: (ifcText: string, filename?: string) => Promise<unknown>;
  focusStorey: string;
  t: (k: string) => string;
  lang: string;
  view2d?: ViewState2D;
  chatPrompt?: { text: string; image?: string } | null;
  clearChatPrompt?: () => void;
  /** Shared MCP executor; it handles validation according to the editor setting. */
  executeToolWithValidation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

interface Message {
  role: 'assistant' | 'user' | 'tool';
  content?: string;
  tools?: ToolCall[];
  thinking?: string;
}

import type { ConversationTurn, ModelCapabilities } from '@skaitch/core/types/ai';
// ── Duplicate detection helpers ────────────────────────────────────────────────
// ── Shared MCP tool executor (same logic as useMcpBridge) ──────────────────────
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  executeSharedTool: Props['executeToolWithValidation'],
  items: ItemsMap,
  focusStorey: string,
  addItem: Props['addItem'],
  updateItem: Props['updateItem'],
  deleteItems: Props['deleteItems'],
  injectIfc?: Props['injectIfc'],
  ai?: AiConfig,
): Promise<unknown> {
  if (MCP_TOOLS.some(tool => tool.name === name)) return executeSharedTool(name, args);
  if (['create_ifc_element', 'update_ifc_element', 'delete_ifc_element'].includes(name)) return executeSharedTool(name, args);
  switch (name) {
    case 'search_tools': return searchChatTools(args.query);
    case 'load_skill': {
      const id = args.id;
      if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(CHAT_SKILLS, id)) return { error: 'Unknown chat skill' };
      return CHAT_SKILLS[id as keyof typeof CHAT_SKILLS];
    }
    case 'call_tool': return { error: 'Expected a BIM tool name and a JSON object in arguments_json' };
    case 'inject_ifc': {
      if (!injectIfc) return { error: 'IFC injection is not available in this context' };
      const ifcText = String(args.ifc_text ?? '');
      if (!ifcText.trim()) return { error: 'ifc_text is required' };
      if (!/ISO-10303-21|IFCPROJECT/i.test(ifcText)) {
        return { error: 'ifc_text must be a complete IFC STEP file, not a fragment' };
      }
      return await injectIfc(ifcText, String(args.filename ?? 'ai_generated.ifc'));
    }

    case 'get_storey_plan_image': {
      const storey = items[focusStorey] as any;
      const url = storey?.geom?.plan?.url;
      if (!url) return { error: 'No plan image found for current storey' };
      return { success: true, image_url: url };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── Tool schema hints shown to the LLM (natural-language, no real API call) ────
function isFullPlanGenerationRequest(txt: string): boolean {
  return /(tous|tout|complet|complete|every|all)/i.test(txt)
    && /(item|élément|element|dalle|slab|mur|wall|pièce|piece|room|porte|door|fenêtre|fenetre|window|cote|cotation|dimension)/i.test(txt)
    && /(plan|étage|etage|storey|floor)/i.test(txt);
}

function compactToolArg(value: unknown): string {
  if (typeof value === 'string') {
    if (value.length > 220) return `${value.slice(0, 120)}… (${value.length} chars)`;
    return value;
  }
  const json = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (json.length > 220) return `${json.slice(0, 120)}… (${json.length} chars)`;
  return json;
}

// ── LLM API Bridge ──────────────────────────────────────────────────────────
// ── Component ────────────────────────────────────────────────────────────────
interface VisualizationCardProps {
  toolCall: ToolCall;
  lang: string;
}

function VisualizationCard({ toolCall, lang }: VisualizationCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const progressIntervalRef = useRef<any>(null);

  const isPending = !toolCall.result;
  const result = toolCall.result as any;
  const isError = result?.error;

  const isVideo = toolCall.args?.type === 'video' || result?.type === 'video';
  const isSimulated = result?.is_simulated;
  const mediaUrl = result?.url;
  const prompt = toolCall.args?.prompt || result?.prompt || '';
  const styleName = toolCall.args?.style || result?.style || '';
  const timeOfDay = toolCall.args?.time_of_day || result?.time_of_day || '';
  const aspectRatio = toolCall.args?.aspect_ratio || result?.aspect_ratio || '16:9';

  useEffect(() => {
    if (isPlaying) {
      const startTime = Date.now();
      const duration = 6000;
      progressIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const pct = Math.min(100, (elapsed / duration) * 100);
        if (pct >= 100) {
          setVideoProgress(0);
          setIsPlaying(false);
          setTimeout(() => setIsPlaying(true), 100);
        } else {
          setVideoProgress(pct);
        }
      }, 50);
    } else {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setVideoProgress(0);
    }

    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, [isPlaying]);

  const handleDownload = async () => {
    if (!mediaUrl) return;
    try {
      if (mediaUrl.startsWith('data:')) {
        const a = document.createElement('a');
        a.href = mediaUrl;
        a.download = `render_${Date.now()}.png`;
        a.click();
      } else {
        const response = await fetch(mediaUrl);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = isVideo && !isSimulated ? `render_${Date.now()}.mp4` : `render_${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(blobUrl);
      }
    } catch (err) {
      window.open(mediaUrl, '_blank');
    }
  };

  if (isPending) {
    return (
      <div className="vis-card vis-loading">
        <div className="vis-glow"></div>
        <div className="vis-loader-content">
          <div className="vis-spinner">
            <svg width="40" height="40" viewBox="0 0 50 50">
              <circle cx="25" cy="25" r="20" fill="none" stroke="url(#vis-loader-grad)" strokeWidth="4" strokeLinecap="round" />
              <defs>
                <linearGradient id="vis-loader-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--accent)" />
                  <stop offset="100%" stopColor="var(--accent-glow, var(--ink-3))" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="vis-loading-text">
            <h4>{makeT(lang)("Generating IA Render...")}</h4>
            <p>{makeT(lang)("Computing textures, light, and volumes...")}</p>
          </div>
          <div className="vis-scanning-line"></div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="vis-card vis-error">
        <div className="vis-error-icon">⚠️</div>
        <div className="vis-error-details">
          <h4>{makeT(lang)("Generation Failed")}</h4>
          <p>{String(result.error)}</p>
        </div>
      </div>
    );
  }

  const isAspectRatio16_9 = aspectRatio === '16:9';
  const isAspectRatio4_3 = aspectRatio === '4:3';
  const aspectClass = isAspectRatio16_9 ? 'aspect-16-9' : isAspectRatio4_3 ? 'aspect-4-3' : 'aspect-1-1';

  return (
    <>
      <div className={`vis-card vis-success ${aspectClass}`}>
        <div className="vis-media-container">
          {isVideo && !isSimulated ? (
            <video src={mediaUrl} controls autoPlay loop className="vis-media-element" />
          ) : (
            <div className="vis-image-wrapper">
              <img
                src={mediaUrl}
                alt="Architectural Render"
                className={`vis-media-element ${isPlaying ? 'ken-burns-active' : ''}`}
              />
              {isVideo && isSimulated && (
                <div className="vis-video-overlay">
                  <div className="rec-indicator">
                    <span className="dot"></span>
                    <span>REC</span>
                  </div>
                  <div className="timecode-indicator">
                    00:0{Math.floor(videoProgress / 20)}:{Math.floor((videoProgress % 20) * 3).toString().padStart(2, '0')}
                  </div>
                  <div className="cam-resolution">8K UHD</div>

                  {!isPlaying && (
                    <button className="play-center-btn" onClick={() => setIsPlaying(true)}>
                      <svg viewBox="0 0 24 24" width="30" height="30">
                        <path d="M8 5v14l11-7z" fill="currentColor" />
                      </svg>
                    </button>
                  )}

                  <div className="vis-video-controls">
                    <button className="ctrl-play-btn" onClick={() => setIsPlaying(!isPlaying)}>
                      {isPlaying ? (
                        <svg viewBox="0 0 24 24" width="16" height="16">
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="currentColor" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="16" height="16">
                          <path d="M8 5v14l11-7z" fill="currentColor" />
                        </svg>
                      )}
                    </button>
                    <div className="ctrl-progress-bg">
                      <div className="ctrl-progress-bar" style={{ width: `${videoProgress}%` }}></div>
                    </div>
                    <span className="ctrl-duration">00:06</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="vis-actions-overlay">
            <button className="vis-act-btn" onClick={() => setIsFullscreen(true)} title={makeT(lang)("Fullscreen")}>
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            </button>
            <button className="vis-act-btn" onClick={handleDownload} title={makeT(lang)("Download")}>
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5l5 5 5-5m-5 5V3" />
              </svg>
            </button>
          </div>
        </div>

        <div className="vis-details">
          <div className="vis-tags">
            {styleName && <span className="vis-tag">✨ {styleName}</span>}
            {timeOfDay && <span className="vis-tag">🌅 {timeOfDay}</span>}
            <span className="vis-tag">📐 {aspectRatio}</span>
            <span className="vis-tag">{isVideo ? '📹 Vidéo Rendu' : '🖼️ Image Rendu'}</span>
          </div>
          <p className="vis-prompt" title={prompt}>
            <strong>Prompt: </strong>{prompt}
          </p>
        </div>
      </div>

      {isFullscreen && (
        <div className="vis-fs-overlay" onClick={() => setIsFullscreen(false)}>
          <button className="vis-fs-close" onClick={() => setIsFullscreen(false)}>×</button>
          <div className="vis-fs-content" onClick={(e) => e.stopPropagation()}>
            {isVideo && !isSimulated ? (
              <video src={mediaUrl} controls autoPlay loop className="vis-fs-media" />
            ) : (
              <img src={mediaUrl} alt="Architectural Render Fullscreen" className={`vis-fs-media ${isPlaying ? 'ken-burns-active' : ''}`} />
            )}
            <div className="vis-fs-caption">
              <p>{prompt}</p>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button className="vis-btn-primary" onClick={handleDownload}>
                  {makeT(lang)("Download Render")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Tools that only READ state — skip validation for these
const READ_ONLY_TOOLS = new Set([
  'search_tools', 'load_skill', 'call_tool', 'execute_script', 'get_view', 'set_view', 'capture_view',
  'get_ifc_scene_overview', 'list_ifc_entities', 'get_element_properties', 'get_survey', 'get_survey_photo',
  'get_storey_plan_image', 'get_storey_floorplan', 'list_spatial_structure',
  'list_projects', 'select_project', 'select_storey', 'measure_distance', 'export_ifc', 'list_opening_types', 'list_object_types',
]);

export default function ChatPanel({
  open, onClose, items, catalogue, ai, selection, setSelection,
  addItem, updateItem, deleteItems, injectIfc, focusStorey, t, lang, view2d,
  chatPrompt, clearChatPrompt, executeToolWithValidation,
}: Props) {
  const liveItems = useRef(items);
  liveItems.current = items;
  const initMsg: Message = {
    role: 'assistant',
    content: makeT(lang)('Hi! I’m your BIM assistant. I have access to {count} tools to query and edit your plan. What would you like to do?', { count: TOOL_HINTS.length }),
  };

  const [messages, setMessages] = useState<Message[]>([initMsg]);
  const [input, setInput]       = useState('');
  const [scriptMode, setScriptMode] = useState(false);
  const [scriptDraft, setScriptDraft] = useState('');
  const [busy, setBusy]         = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [modelCaps, setModelCaps] = useState<ModelCapabilities | null>(null);
  const lastInjectedImage = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortControllerRef.current?.abort(); }, []);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    // Discover model capabilities on mount or when model changes
    if (ai.model && (findCredential(ai.credentials, 'chat', ai.provider, ai.baseUrl) || localAiEndpoint(ai.provider, ai.baseUrl))) {
      discoverModelCapabilities(ai.provider, ai.model, ai.apiKey, ai.baseUrl, ai.useCorsProxy, findCredential(ai.credentials, 'chat', ai.provider, ai.baseUrl)?.id, findCredential(ai.credentials, 'chat', ai.provider, ai.baseUrl)?.version).then(setModelCaps);
    }
  }, [ai.model, ai.provider, ai.apiKey, ai.baseUrl, ai.useCorsProxy, ai.credentials]);

  useEffect(() => {
    setMessages([initMsg]);
    lastInjectedImage.current = null;
  }, [lang]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setAttachment(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setBusy(false);
  }, []);

  const executeScript = async () => {
    if (!scriptDraft.trim() || abortControllerRef.current) return;
    const code = scriptDraft;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setBusy(true);
    let result: unknown;
    try {
      result = await runCodeMode(code, items, catalogue, controller.signal);
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setBusy(false);
      }
    }
    if (!controller.signal.aborted) {
      setMessages(previous => [...previous, {
        role: 'assistant', tools: [{ name: 'execute_script', args: { code }, result }],
      }]);
    }
  };

  const send = useCallback(async (txt: string, attachedImg?: string | null) => {
    const finalTxt = txt.trim();
    if ((!finalTxt && !attachedImg) || abortControllerRef.current) return;
    const fullPlanGeneration = isFullPlanGenerationRequest(finalTxt);

    const userMsg: Message = { role: 'user', content: finalTxt || (makeT(lang)("[Image attached]")) };
    const historyMsgs = [...messages, userMsg];

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setBusy(true);
    try {
      // 0. Inject plan image once per conversation:
      //    - always on first user message if a plan image exists (AI needs context)
      //    - on subsequent messages only when prompt explicitly references the image/plan
      const isFirstUserMsg = messages.length === 1;
      const storeyForPlan = items[focusStorey] as any;
      const hasPlanImage = !!(storeyForPlan?.type === 'Storey' && storeyForPlan.geom?.plan?.url);
      const needsPlanImage = !attachedImg && !lastInjectedImage.current && hasPlanImage && (
        isFirstUserMsg ||
        /plan|visibl|depuis|from the|étage|floor|storey|image|photo|scan|dessin/i.test(finalTxt)
      );
      if (needsPlanImage) {
        try {
          const imgResult = await executeTool('get_storey_plan_image', {}, executeToolWithValidation, items, focusStorey, addItem, updateItem, deleteItems, injectIfc);
          if (imgResult && typeof imgResult === 'object' && 'image_url' in imgResult) {
            attachedImg = (imgResult as any).image_url;
            lastInjectedImage.current = attachedImg;
          }
        } catch {}
      }

      // 1. Intent detection (skip if prompt references the plan — let LLM analyze the image)
      const context = { finalTxt, items, focusStorey, lang, selection, view2d };
      const intent = needsPlanImage ? null : await conversationIntent(context, controller.signal);
      controller.signal.throwIfAborted();
      const toolCalls: ToolCall[] = [];
      let toolImage: string | null = attachedImg || null;

      if (intent) {
        const result = await executeTool(intent.name, intent.args, executeToolWithValidation, items, focusStorey, addItem, updateItem, deleteItems, injectIfc);

        let isRedundantImage = false;
        if (intent.name === 'get_storey_plan_image' && result && typeof result === 'object' && 'image_url' in result) {
          const url = (result as any).image_url;
          if (lastInjectedImage.current) {
            // Already injected in this conversation — skip
            isRedundantImage = true;
          } else {
            toolImage = url;
            lastInjectedImage.current = url;
          }
        }

        if (!isRedundantImage) {
          toolCalls.push({ name: intent.name, args: intent.args, result });
        }

        if (result && typeof result === 'object' && 'id' in result) {
          const id = (result as { id: string }).id;
          setTimeout(() => setSelection([id]), 100);
        }
      }

      if (attachedImg) lastInjectedImage.current = attachedImg;

      // 2. Add user message + empty assistant placeholder in one batch
      setMessages(m => [...m, userMsg, {
        role: 'assistant',
        content: fullPlanGeneration && toolCalls[0]?.name === 'get_storey_plan_image'
          ? (makeT(lang)("Plan loaded. Starting full structured extraction in steps."))
          : '',
        tools: toolCalls.length > 0 ? toolCalls : undefined,
      }]);
      setInput('');
      setAttachment(null);

      // Relay server turns; confirmations and captures require the editor.
      let turn: ConversationTurn | null = { messages: historyMsgs, round: 0 };
      let receipts: string[] | undefined;
      while (turn) {
        controller.signal.throwIfAborted();
        const res = await fetchConversation(
          turn.messages,
          ai,
          { ...context, items: liveItems.current },
          toolImage,
          (chunk: string, isThinking: boolean) => {
            setMessages(m => {
              const copy = [...m];
              const last = { ...copy[copy.length - 1] };
              if (isThinking) last.thinking = (last.thinking ?? '') + chunk;
              else last.content = (last.content ?? '') + chunk;
              copy[copy.length - 1] = last;
              return copy;
            });
          },
          controller.signal, turn.round, receipts
        );
        controller.signal.throwIfAborted();
        toolImage = null;

        const roundToolUses = res.toolUses;

        if (roundToolUses.length === 0) {
          break;
        }

        // Execute all tools for this round, collecting results before updating UI
        const toolResultParts: string[] = [];
        const roundToolResults: ToolCall[] = [];
        let batchRejected = false;
        let rejectionReason = '';

        for (let k = 0; k < roundToolUses.length; k++) {
          controller.signal.throwIfAborted();
          const toolUse = roundToolUses[k];
          const tName = toolUse.name;
          const tArgs = toolUse.input as Record<string, unknown>;

          let result: unknown;
          if (batchRejected && !READ_ONLY_TOOLS.has(tName)) {
            result = { error: `Annulé car l'action précédente a été refusée par l'utilisateur. Motif : ${rejectionReason}` };
          } else {
            try {
              result = tName === 'execute_script'
                ? await runCodeMode(tArgs.code, liveItems.current, catalogue, controller.signal)
                : await executeTool(tName, tArgs, executeToolWithValidation, items, focusStorey, addItem, updateItem, deleteItems, injectIfc, ai);
            } catch (err) {
              // User rejected in validation dialog — surface as a tool error so the AI can react
              result = { error: err instanceof Error ? err.message : String(err) };
              if (!READ_ONLY_TOOLS.has(tName)) {
                batchRejected = true;
                rejectionReason = err instanceof Error ? err.message : String(err);
              }
            }
          }

          controller.signal.throwIfAborted();
          // If the tool executed successfully and returned updated geometry, propagate shifts and property changes to subsequent tool uses!
          if (result && typeof result === 'object' && 'updated_geom' in result && (result as any).success && !(result as any).error) {
            const remaining = await adjustConversation({ ...context, items: liveItems.current }, tName, tArgs, (result as any).updated_geom, roundToolUses.slice(k + 1), controller.signal);
            roundToolUses.splice(k + 1, remaining.length, ...remaining);
          }

          // Images (capture_view, get_storey_floorplan…) travel as real images, not as base64 text.
          const detached = detachToolImage(result);
          if (detached.image) toolImage = detached.image;
          toolResultParts.push(`${tName}: ${JSON.stringify(detached.result)}`);
          roundToolResults.push({ name: tName, args: tArgs, result });
          if (result && typeof result === 'object' && 'id' in result && !(result as any).error) {
            const id = (result as { id: string }).id;
            setTimeout(() => setSelection([id]), 100);
          }
        }
        // Update last assistant message with all tool calls at once
        setMessages(m => {
          const copy = [...m];
          const lastAssistant = copy[copy.length - 1];
          if (lastAssistant?.role === 'assistant') {
            copy[copy.length - 1] = { ...lastAssistant, tools: roundToolResults };
          }
          return copy;
        });

        turn = res.next;
        receipts = toolResultParts;
        if (turn) setMessages(m => [...m, { role: 'assistant', content: '' }]);
      }

      // Fallback content if last message is empty
      setMessages(m => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (!last.content && !last.thinking && !last.tools?.length) {
          copy[copy.length - 1] = { ...last, content: toolCalls.length ? (makeT(lang)("Done!")) : '…' };
        }
        return copy;
      });

    } catch (err: any) {
      setMessages(m => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (controller.signal.aborted) return m;
        if (last.role === 'assistant' && !last.content && !last.thinking) {
          copy[copy.length - 1] = { role: 'assistant', content: `❌ Error: ${(err as Error).message}` };
        } else {
          copy.push({ role: 'assistant', content: `❌ Error: ${(err as Error).message}` });
        }
        return copy;
      });
    } finally {
      if (abortControllerRef.current === controller) { abortControllerRef.current = null; setBusy(false); }
    }
  }, [messages, ai, items, catalogue, focusStorey, lang, selection, addItem, updateItem, deleteItems, injectIfc, setSelection, view2d, executeToolWithValidation]);

  useEffect(() => {
    if (chatPrompt && !busy) {
      send(chatPrompt.text, chatPrompt.image);
      if (clearChatPrompt) clearChatPrompt();
    }
  }, [chatPrompt, busy, send, clearChatPrompt]);

  if (!open) return null;

  const actionGroups = lang === 'fr' ? [
    {
      title: '📍 Calibration & Cotation',
      items: [
        { label: 'Poser des jalons aux angles', text: 'Poser des jalons de calibration aux angles structurels du bâtiment' },
        { label: 'Générer les cotations de l\'image', text: 'Générer les cotations (dimensions) vues sur l\'image' },
      ]
    },
    {
      title: '🏗️ Modélisation Globale',
      items: [
        { label: 'Créer tous les éléments possibles', text: 'Créer tous les items possibles depuis le plan de l\'étage' },
      ]
    },
    {
      title: '🧱 Création Sélective',
      items: [
        { label: 'Créer les murs', text: 'Crée les murs visibles sur le plan' },
        { label: 'Créer les pièces / espaces', text: 'Crée les pièces visibles sur le plan' },
        { label: 'Créer les portes & fenêtres', text: 'Crée les portes et fenêtres visibles sur le plan' },
        { label: 'Créer une dalle de sol', text: 'Crée une dalle sur l\'emprise du plan' },
      ]
    },
    {
      title: '⚡ Outils & Analyse',
      items: [
        { label: 'Analyser le plan d\'étage', text: 'Analyse le plan de l\'étage' },
        { label: 'Exporter le plan en IFC', text: 'Exporte l\'IFC' },
      ]
    }
  ] : [
    {
      title: '📍 Calibration & Dimensioning',
      items: [
        { label: 'Place calibration markers', text: 'Place calibration markers on building structural corners' },
        { label: 'Generate image dimensions', text: 'Generate dimensions visible on the image' },
      ]
    },
    {
      title: '🏗️ Complete Modeling',
      items: [
        { label: 'Create every possible item', text: 'Create every possible item from the storey plan' },
      ]
    },
    {
      title: '🧱 Selective Creation',
      items: [
        { label: 'Create walls', text: 'Create the walls visible on the plan' },
        { label: 'Create rooms', text: 'Create the rooms visible on the plan' },
        { label: 'Create doors & windows', text: 'Create the doors and windows visible on the plan' },
        { label: 'Create ground slab', text: 'Create a slab from the plan footprint' },
      ]
    },
    {
      title: '⚡ Analysis & Tools',
      items: [
        { label: 'Analyze storey plan', text: 'Analyze the storey plan' },
        { label: 'Export model to IFC', text: 'Export IFC' },
      ]
    }
  ];

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <div className="av">AI</div>
        <div className="who">
          <div className="nm">{makeT(lang)("BIM Assistant · MCP4IFC")}</div>
          <div className="st" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span><b>● Live</b> · {ai.provider} · {ai.model}</span>
            {(() => {
              const icons = {
                text: { emoji: '📝', label: 'Text' },
                image: { emoji: '🖼️', label: 'Image/Vision' },
                tools: { emoji: '🔧', label: 'Function Calling' },
                thinking: { emoji: '🧠', label: 'Extended Thinking' },
              };
              return (
                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
                  {modelCaps ? (
                    Object.entries(modelCaps).map(([key, enabled]) =>
                      enabled && (
                        <span
                          key={key}
                          title={icons[key as keyof typeof icons].label}
                          style={{ fontSize: 14, cursor: 'help', opacity: 0.7 }}
                        >
                          {icons[key as keyof typeof icons].emoji}
                        </span>
                      )
                    )
                  ) : (
                    <span style={{ fontSize: 10, opacity: 0.4 }}>discovering...</span>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
        <div className="actions">
          <button className="icon-btn" onClick={() => { setMessages([initMsg]); lastInjectedImage.current = null; }} title={makeT(lang)("New conversation")}>
            <svg width="13" height="13" viewBox="0 0 20 20"><path d="M4 10a6 6 0 116 6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M2 6v4h4M10 7v3l2 2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
          </button>
          <button className="icon-btn" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {messages.map((m, i) => {
          if (m.role === 'assistant' && m.tools?.length) {
            const allTools = m.tools;
            const isDup = (t: ToolCall) => t.result && typeof t.result === 'object' && 'duplicate' in (t.result as object) && (t.result as any).duplicate === true;
            const hasErr = (t: ToolCall) => t.result && typeof t.result === 'object' && 'error' in (t.result as object);
            const createdCount = allTools.filter(t => !isDup(t) && !hasErr(t)).length;
            const dupCount = allTools.filter(isDup).length;
            const errorCount = allTools.filter(hasErr).length;
            const toolsCopyText = allTools.map(tc =>
              `[${tc.name}] ${JSON.stringify(tc.args)}\n→ ${JSON.stringify(tc.result)}`
            ).join('\n');
            const fullCopyText = [m.thinking && `<thinking>\n${m.thinking}\n</thinking>`, toolsCopyText, m.content].filter(Boolean).join('\n\n');
            return (
              <div key={i}>
                {m.thinking && (
                  <div className="thinking-block">
                    <details>
                      <summary>
                        <div className="icon">🧠</div>
                        <span>{makeT(lang)("Thought")}</span>
                        <svg className="chevron" width="10" height="10" viewBox="0 0 20 20"><path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" /></svg>
                      </summary>
                      <div className="content">{m.thinking}</div>
                    </details>
                  </div>
                )}
                <div className="msg assistant">
                  <div className="tool-call">
                    <div className="head" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                      <svg width="11" height="11" viewBox="0 0 20 20"><path d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5z" fill="currentColor" /></svg>
                      <span style={{ opacity: 0.7 }}>{allTools.length} {makeT(lang)("calls")}</span>
                      {createdCount > 0 && <span className="st">✓ {createdCount}</span>}
                      {dupCount > 0 && <span className="st" style={{ color: 'oklch(0.6 0.18 200)' }}>⊘ {dupCount} {makeT(lang)("dupl.")}</span>}
                      {errorCount > 0 && <span className="st" style={{ color: 'oklch(0.6 0.18 25)' }}>✗ {errorCount}</span>}
                      <button
                        onClick={() => navigator.clipboard.writeText(fullCopyText)}
                        title={makeT(lang)("Copy")}
                        style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', opacity: 0.5, fontSize: 10 }}
                      >⎘</button>
                    </div>
                    {allTools.map((tc, ti) => {
                      if (tc.name === 'execute_script') {
                        const code = String(tc.args.code ?? '');
                        return (
                          <div key={ti} className="res">
                            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(tc.result, null, 2)}</pre>
                            <details>
                              <summary>JavaScript</summary>
                              <button className="btn" onClick={() => navigator.clipboard.writeText(code)}>{makeT(lang)("Copy")}</button>
                              <pre style={{ overflow: 'auto', maxHeight: 240 }}><code>{code}</code></pre>
                            </details>
                          </div>
                        );
                      }
                      const isToolDup = isDup(tc);
                      const isToolErr = hasErr(tc);
                      const statusColor = isToolErr ? 'oklch(0.6 0.18 25)' : isToolDup ? 'oklch(0.6 0.18 200)' : undefined;
                      const statusLabel = isToolErr ? '✗ error' : isToolDup ? '⊘ doublon' : '✓ ok';
                      return (
                        <details key={ti} open={allTools.length === 1 || isToolErr} style={ti > 0 ? { marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4 } : {}}>
                          <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <svg width="11" height="11" viewBox="0 0 20 20"><path d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5z" fill="currentColor" /></svg>
                            <span className="nm" style={{ opacity: isToolDup ? 0.5 : 1 }}>{tc.name}</span>
                            <span className="st" style={{ color: statusColor }}>{statusLabel}</span>
                          </summary>
                          <div className="args" style={{ marginTop: 4 }}>
                            {Object.entries(tc.args).map(([k, v], j, arr) => (
                              <span key={k}>{k}=<span>{compactToolArg(v)}</span>{j < arr.length - 1 ? ', ' : ''}</span>
                            ))}
                          </div>
                          <div className="res" style={tc.name === 'generate_visualization' ? { paddingTop: 4 } : { fontFamily: 'var(--font-mono)', fontSize: 10.5, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>
                            {tc.name === 'generate_visualization' ? (
                              <VisualizationCard toolCall={tc} lang={lang} />
                            ) : typeof tc.result === 'object' && tc.result && 'image_url' in tc.result ? (
                              <div style={{ marginTop: 8 }}>
                                <img src={(tc.result as any).image_url} alt="tool result" style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 4 }} />
                              </div>
                            ) : (
                              <>→ {typeof tc.result === 'object' ? JSON.stringify(tc.result, null, 2) : String(tc.result)}</>
                            )}
                          </div>
                        </details>
                      );
                    })}
                    {m.content && <div className="text-after" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', opacity: 0.8 }}>{m.content}</div>}
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div key={i}>
              {m.role === 'assistant' && m.thinking && (
                <div className="thinking-block">
                  <details>
                    <summary>
                      <div className="icon">🧠</div>
                      <span>{makeT(lang)("Thought")}</span>
                      <svg className="chevron" width="10" height="10" viewBox="0 0 20 20"><path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" /></svg>
                    </summary>
                    <div className="content">{m.thinking}</div>
                  </details>
                </div>
              )}
              <div className={`msg ${m.role}`}>
                <div className="bubble">
                  {(m.content || '').split('\n').map((line, j) => (
                    <div key={j} style={{ fontFamily: line.startsWith('•') || line.startsWith('`') ? 'var(--font-mono)' : undefined, fontSize: line.startsWith('•') ? 11 : undefined }}>
                      {line || '\u00A0'}
                    </div>
                  ))}
                  {m.role === 'user' && (
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 6 }}>
                      <button
                        onClick={() => setInput(m.content)}
                        title={makeT(lang)("Edit / Copy to input")}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.65, fontSize: 10, padding: '2px 4px', color: 'inherit', display: 'flex', alignItems: 'center', gap: 3, transition: 'opacity 0.2s' }}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = '0.65'}
                      >
                        <span>✏️</span>
                        <span>{makeT(lang)("Edit")}</span>
                      </button>
                      <button
                        onClick={() => send(m.content)}
                        title={makeT(lang)("Re-run this request")}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.65, fontSize: 10, padding: '2px 4px', color: 'inherit', display: 'flex', alignItems: 'center', gap: 3, transition: 'opacity 0.2s' }}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = '0.65'}
                      >
                        <span>🔄</span>
                        <span>{makeT(lang)("Re-run")}</span>
                      </button>
                    </div>
                  )}
                  {m.role === 'assistant' && (m.content || m.thinking) && (
                    <button
                      onClick={() => navigator.clipboard.writeText([m.thinking && `<thinking>\n${m.thinking}\n</thinking>`, m.content].filter(Boolean).join('\n\n'))}
                      title={makeT(lang)("Copy")}
                      style={{ display: 'block', marginTop: 6, background: 'none', border: 'none', cursor: 'pointer', opacity: 0.4, fontSize: 11, padding: '2px 0', textAlign: 'left' }}
                    >⎘</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {busy && (() => {
          const last = messages[messages.length - 1];
          const waiting = !last || last.role !== 'assistant' || (!last.content && !last.thinking);
          return waiting ? (
            <div className="msg assistant">
              <div className="bubble" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {[0, 0.2, 0.4].map((delay, i) => (
                  <span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--ink-3)', animation: `pulse1 1.2s infinite ${delay}s` }} />
                ))}
              </div>
            </div>
          ) : null;
        })()}

      </div>

      <div className="chat-input-area" style={{ borderTop: '1px solid var(--border)', background: 'var(--panel-1)', position: 'relative' }}>
        {showActionsMenu && (
          <div
            className="actions-menu-popover"
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 12,
              right: 12,
              marginBottom: 8,
              background: 'var(--panel-2)',
              backdropFilter: 'blur(12px)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3), 0 8px 10px -6px rgba(0,0,0,0.3)',
              maxHeight: 320,
              overflowY: 'auto',
              zIndex: 100,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, color: 'var(--ink-2)', opacity: 0.8 }}>
                ⚡ {makeT(lang)("AI Quick Actions")}
              </span>
              <button
                onClick={() => setShowActionsMenu(false)}
                style={{ background: 'none', border: 'none', color: 'var(--ink-2)', cursor: 'pointer', fontSize: 12, fontWeight: 'bold' }}>
                ✕
              </button>
            </div>
            {actionGroups.map((group, gIdx) => (
              <div key={gIdx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', opacity: 0.9 }}>
                  {group.title}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
                  {group.items.map((item, iIdx) => (
                    <button
                      key={iIdx}
                      onClick={() => {
                        send(item.text);
                        setShowActionsMenu(false);
                      }}
                      style={{
                        textAlign: 'left',
                        background: 'var(--panel-1)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: 11.5,
                        color: 'var(--ink)',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--accent)';
                        e.currentTarget.style.color = 'var(--bg)';
                        e.currentTarget.style.borderColor = 'var(--accent)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--panel-1)';
                        e.currentTarget.style.color = 'var(--ink)';
                        e.currentTarget.style.borderColor = 'var(--border)';
                      }}
                    >
                      <span>{item.label}</span>
                      <span style={{ opacity: 0.6, fontSize: 10 }}>➔</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {attachment && (
          <div className="attachment-preview" style={{ padding: '8px 12px', paddingBottom: 0 }}>
            <div style={{ position: 'relative', display: 'inline-block', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <img src={attachment} alt="attachment" style={{ height: 60, display: 'block' }} />
              <button
                onClick={() => setAttachment(null)}
                style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.7)', color: 'white', border: 'none', borderRadius: '50%', width: 16, height: 16, cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ×
              </button>
            </div>
          </div>
        )}

        <div className="chat-input">
          <div className="assistant-context">
            {makeT(lang)('Context')}: {items[focusStorey]?.name ?? makeT(lang)('Project')}
            {' · '}{selection.length} {t('selected')}
          </div>
          {selection.length > 0 && (
            <span className="ctx-chip">@{selection.length} {t('selected')}</span>
          )}
          <textarea
            placeholder={scriptMode ? 'return callTool("list_spatial_structure");' : makeT(lang)("Describe what you want…")}
            aria-label={scriptMode ? 'JavaScript' : makeT(lang)("Describe what you want…")}
            value={scriptMode ? scriptDraft : input}
            onChange={(e) => (scriptMode ? setScriptDraft : setInput)(e.target.value)}
            onKeyDown={(e) => {
              if (!scriptMode && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input, attachment); }
            }}
            rows={2}
          />
          {scriptMode && <details>
            <summary>{lang === 'fr' ? 'Outils disponibles' : 'Available tools'}</summary>
            <code>{CODE_MODE_TOOLS.join(', ')}</code>
          </details>}
          <div className="row">
            <button className="btn" aria-pressed={scriptMode} disabled={busy} onClick={() => { setScriptMode(value => !value); setShowActionsMenu(false); }}>
              JavaScript
            </button>
            <input type="file" ref={fileRef} style={{ display: 'none' }} accept="image/*" onChange={onFileChange} />
            <button
              className="icon-btn"
              disabled={scriptMode}
              onClick={() => fileRef.current?.click()}
              title={makeT(lang)("Attach image")}
              style={{ padding: 4, opacity: 0.7 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
            </button>

            <button
              className="icon-btn text-accent"
              disabled={scriptMode}
              onClick={() => setShowActionsMenu(!showActionsMenu)}
              title={makeT(lang)("AI Quick Actions")}
              style={{
                padding: 4,
                opacity: showActionsMenu ? 1 : 0.7,
                color: showActionsMenu ? 'var(--accent)' : 'inherit',
                marginLeft: 8
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </button>

            <div className="spacer" style={{ flex: 1 }} />

            {busy ? (
              <button className="btn stop-btn" onClick={stop} style={{ background: 'oklch(0.6 0.18 25)', color: 'white', borderColor: 'oklch(0.6 0.18 25)' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                {makeT(lang)("Stop")}
              </button>
            ) : scriptMode ? (
              <button className="btn primary send" disabled={!scriptDraft.trim()} onClick={executeScript}>
                {lang === 'fr' ? 'Exécuter' : 'Run'}
              </button>
            ) : (
              <button className="btn primary send" disabled={(!input.trim() && !attachment)} onClick={() => send(input, attachment)}>
                <svg width="12" height="12" viewBox="0 0 20 20"><path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {makeT(lang)("Send")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
