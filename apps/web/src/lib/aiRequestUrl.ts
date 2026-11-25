/** The CORS bridge exists only on the Vite development server. */
export function aiRequestUrl(url: string, useCorsProxy?: boolean, development = import.meta.env.DEV): string {
  return development && useCorsProxy && /^https?:\/\//.test(url)
    ? '/cors-proxy/' + encodeURIComponent(url) : url;
}
