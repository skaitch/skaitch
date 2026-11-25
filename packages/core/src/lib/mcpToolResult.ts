const DATA_IMAGE = /^data:(image\/[^;]+);base64,(.+)$/s;

/** Return a native MCP image block so external vision clients can consume captures, generated images and floor plans. */
export function mcpToolResult(result: any) {
  const capture = typeof result?.image_url === 'string' && result.image_url.startsWith('data:') ? result.image_url : null;
  const generated = typeof result?.url === 'string' && /^data:image\//.test(result.url) ? result.url : null;
  const plan = typeof result?.plan?.url === 'string' && DATA_IMAGE.test(result.plan.url) ? result.plan.url : null;
  // The bytes travel once, in the image block: base64 left in the JSON text gets truncated by clients.
  const textResult = capture ? { ...result, image_url: undefined }
    : generated ? { ...result, url: undefined }
    : plan ? { ...result, plan: { ...result.plan, url: undefined } }
    : result;
  const content: any[] = [{ type: 'text', text: typeof textResult === 'string' ? textResult : JSON.stringify(textResult, null, 2) }];
  const match = (capture ?? generated ?? plan)?.match(DATA_IMAGE);
  if (match) content.push({ type: 'image', mimeType: match[1], data: match[2] });
  return { content, ...(result?.error ? { isError: true } : {}) };
}
