/// <reference lib="webworker" />
import { parseDxf } from '@skaitch/core/cad/dxf';

self.onmessage = (e: MessageEvent<Uint8Array>) => {
  try {
    self.postMessage({ ok: true, drawing: parseDxf(e.data) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
