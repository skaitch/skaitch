import { useEffect, useState } from 'react';

/**
 * Stays on screen while MCP remote access is on (SKAITCH_MCP_REMOTE_HOST): anyone with the
 * secret URL can read the library and propose changes, which still need confirming here.
 */
export default function RemoteAccessBanner() {
  const [remote, setRemote] = useState(false);
  useEffect(() => {
    const mcp = window.skaitchDesktop?.mcp;
    if (!mcp) return;
    let active = true;
    mcp.status().then(status => { if (active) setRemote(status.remote); }).catch(() => {});
    const stop = mcp.onStatus(status => { if (active) setRemote(status.remote); });
    return () => { active = false; stop(); };
  }, []);
  if (!remote) return null;
  return (
    <div className="remote-access-banner" role="alert"
      title="Coupez-le en relançant l’app sans SKAITCH_MCP_REMOTE_HOST. Supprimez mcp-remote-token pour révoquer l’URL.">
      <strong>Accès MCP distant ouvert</strong>
      <span>Chaque modification reste à confirmer ici.</span>
    </div>
  );
}
