import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function until(window: BrowserWindow, expression: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`).catch(() => false)) return;
    await wait(250);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function capture(window: BrowserWindow, out: string, name: string) {
  await wait(1500);
  await writeFile(join(out, name), (await window.webContents.capturePage()).toPNG());
}

/**
 * Development check driven by SKAITCH_SMOKE_OUT: exercises the built renderer, the IPC
 * bridge, the Node IFC engine and the file library, then saves screenshots.
 * Run it only with SKAITCH_LIBRARY_DIR and SKAITCH_USER_DATA pointing at scratch folders.
 */
/** Debug helper: import an IFC served by the renderer through the home page, then capture 2D and 3D. */
export async function captureIfcImport(window: BrowserWindow, out: string, url: string) {
  await until(window, `document.body.innerText.includes('Mes projets')`);
  const result = await window.webContents.executeJavaScript(`(async () => {
    const alerts = []; window.alert = m => alerts.push(String(m));
    const bytes = await (await fetch(${JSON.stringify(url)})).arrayBuffer();
    const input = document.querySelector('input[type=file]');
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'Plan_2.ifc')); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 160 && !document.querySelector('#plan-svg-canvas') && !alerts.length; i++) await new Promise(r => setTimeout(r, 250));
    return { alerts };
  })()`);
  await capture(window, out, 'import-2d.png');
  await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b => ['Vue 3D', '3D View'].includes(b.textContent.trim()))?.click()`);
  await wait(8000);
  await capture(window, out, 'import-3d.png');
  return { ok: true, ...result };
}

/** Debug helper: open an existing library project by name and capture its 2D and 3D views. */
export async function captureProject(window: BrowserWindow, out: string, name: string) {
  await until(window, `document.body.innerText.includes(${JSON.stringify(name)})`);
  await window.webContents.executeJavaScript(`[...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent === ${JSON.stringify(name)})?.click()`);
  await until(window, `document.querySelector('.editor-header')`);
  await clickText(window, ['2D Plan', 'Plan 2D']);
  await until(window, `document.querySelector('#plan-svg-canvas')`);
  await capture(window, out, 'project-2d.png');
  await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b => ['Vue 3D', '3D View'].includes(b.textContent.trim()))?.click()`);
  await wait(8000);
  await capture(window, out, 'project-3d.png');
  return { ok: true };
}

/** Clicks the first element whose own text is exactly one of `labels` (any UI language). */
async function clickText(window: BrowserWindow, labels: string[]) {
  return window.webContents.executeJavaScript(`(() => {
    const labels = ${JSON.stringify(labels)};
    const el = [...document.querySelectorAll('button, [role=tab], a, span, div, li')]
      .find(e => labels.includes(e.textContent.trim()) && [...e.children].every(c => !labels.includes(c.textContent.trim())));
    el?.click();
    return Boolean(el);
  })()`);
}

/** Debug helper: open a library project and capture a short tour of the editor, for demos. */
export async function captureTour(window: BrowserWindow, out: string, name: string) {
  const steps: Record<string, boolean> = {};
  await until(window, `document.body.innerText.includes(${JSON.stringify(name)})`);
  await capture(window, out, 'tour-1-home.png');
  await window.webContents.executeJavaScript(`[...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent === ${JSON.stringify(name)})?.click()`);
  // The editor reopens on the last view used (it may be Sheets, without any canvas).
  await until(window, `document.querySelector('.editor-header')`);
  steps.plan = await clickText(window, ['2D Plan', 'Plan 2D']);
  await until(window, `document.querySelector('#plan-svg-canvas')`);
  await capture(window, out, 'tour-2-plan.png');
  steps.properties = await clickText(window, ['Living / Kitchen']);
  await capture(window, out, 'tour-3-properties.png');
  steps.view3d = await clickText(window, ['3D View', 'Vue 3D']);
  await wait(8000);
  await capture(window, out, 'tour-4-3d.png');
  steps.sheets = await clickText(window, ['Sheets', 'Feuilles']);
  await capture(window, out, 'tour-5-sheets.png');
  steps.ifc = await clickText(window, ['IFC Browser', 'Navigateur IFC']);
  await capture(window, out, 'tour-6-ifc.png');
  steps.export = await clickText(window, ['Export', 'Exporter']);
  await capture(window, out, 'tour-7-export.png');
  return { ok: true, steps };
}

/**
 * Debug helper for demos: open a project, send `prompt` to the AI assistant and capture the
 * window every few seconds until the assistant is done. Uses the AI settings of the user data.
 */
export async function captureChat(window: BrowserWindow, out: string, name: string, prompt: string) {
  const shot = async (n: number) => writeFile(join(out, `chat-${String(n).padStart(3, '0')}.png`), (await window.webContents.capturePage()).toPNG());
  await until(window, `document.body.innerText.includes(${JSON.stringify(name)})`);
  await window.webContents.executeJavaScript(`[...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent === ${JSON.stringify(name)})?.click()`);
  await until(window, `document.querySelector('.editor-header')`);
  await clickText(window, ['2D Plan', 'Plan 2D']);
  await until(window, `document.querySelector('#plan-svg-canvas')`);
  await clickText(window, ['AI Assistant', 'Assistant IA']);
  await until(window, `document.querySelector('textarea')`);
  await wait(1000);
  let n = 0;
  await shot(n++);
  await window.webContents.executeJavaScript(`(() => {
    const area = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, ${JSON.stringify(prompt)});
    area.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(600);
  await shot(n++);
  await window.webContents.executeJavaScript(`document.querySelector('button.send')?.click()`);
  const busy = () => window.webContents.executeJavaScript(`Boolean(document.querySelector('.stop-btn'))`);
  let seenBusy = false, idle = 0;
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    await wait(4000);
    await shot(n++);
    if (await busy()) { seenBusy = true; idle = 0; } else if (seenBusy || n > 6) { if (++idle >= 2) break; }
  }
  await clickText(window, ['3D View', 'Vue 3D']);
  await wait(8000);
  await shot(n++);
  const transcript = await window.webContents.executeJavaScript(`document.querySelector('textarea')?.closest('aside, section, div')?.parentElement?.innerText?.slice(-1500) ?? ''`);
  return { ok: true, frames: n, seenBusy, transcript };
}

export async function runSmokeTest(window: BrowserWindow, out: string) {
  const errors: string[] = [];
  const warnings: string[] = [];
  window.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
    else if (event.level === 'warning') warnings.push(event.message);
  });
  await until(window, `document.body.innerText.includes('Mes projets') || document.body.innerText.includes('My projects')`);
  await capture(window, out, '1-home-empty.png');
  const engine = await window.webContents.executeJavaScript(`(async () => {
    const bridge = window.skaitchDesktop;
    const before = await bridge.library.list();
    const ifc = await (await fetch('/ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc')).arrayBuffer();
    const imported = await bridge.bim('import-ifc', ifc);
    const now = new Date().toISOString();
    const stored = await bridge.library.write('proj_smoke', { id: 'proj_smoke', name: 'Maison test', description: 'Smoke test', createdAt: now, updatedAt: now, itemsJson: JSON.stringify(imported.items) });
    const after = await bridge.library.list();
    let invalid = null;
    try { await bridge.library.read('../escape'); } catch (error) { invalid = error.message; }
    return { before: before.length, importedItems: Object.keys(imported.items).length, storedName: stored.name, revision: stored.modelRevision, after: after.map(p => p.name), invalid };
  })()`);
  await window.webContents.executeJavaScript('location.reload()');
  await until(window, `document.body.innerText.includes('Maison test')`);
  await capture(window, out, '2-home-with-project.png');
  await window.webContents.executeJavaScript(`[...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent === 'Maison test')?.click()`);
  await until(window, `document.querySelector('#plan-svg-canvas, canvas')`);
  await capture(window, out, '3-editor.png');
  // The real UI flow: pick an IFC file in the home page's file input.
  await window.webContents.executeJavaScript('location.reload()');
  await until(window, `document.body.innerText.includes('Maison test')`);
  const uiImport = await window.webContents.executeJavaScript(`(async () => {
    const alerts = [];
    window.alert = message => alerts.push(String(message));
    const bytes = await (await fetch('/ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc')).arrayBuffer();
    const input = document.querySelector('input[type=file]');
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'Maison importee.ifc'));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 120 && !document.querySelector('#plan-svg-canvas') && !alerts.length; i++) await new Promise(r => setTimeout(r, 250));
    return { alerts, editorOpen: !!document.querySelector('#plan-svg-canvas'), library: (await window.skaitchDesktop.library.list()).map(p => p.name) };
  })()`);
  await capture(window, out, '4-ui-import.png');
  await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b => ['Vue 3D', '3D View'].includes(b.textContent.trim()))?.click()`);
  await wait(8000);
  await capture(window, out, '5-ui-import-3d.png');
  return { ok: errors.length === 0 && uiImport.editorOpen && !uiImport.alerts.length, engine, uiImport, consoleErrors: errors, consoleWarnings: warnings };
}

/**
 * Debug helper: list the provider's models and run the model test with the key saved in
 * this profile, through the same bridge as the settings. The key never leaves the main process.
 */
export async function checkAiProvider(window: BrowserWindow, provider: string, model: string) {
  await until(window, `window.skaitchDesktop`);
  return window.webContents.executeJavaScript(`(async () => {
    const bridge = window.skaitchDesktop.ai;
    const ai = { provider: ${JSON.stringify(provider)}, model: ${JSON.stringify(model)}, temperature: 0 };
    const out = {};
    try { const list = await bridge.request('models', { ai: { ...ai, model: ai.model || 'list' } }); out.models = list.length; out.sample = list.slice(0, 12); if (!ai.model) ai.model = list.find(m => /2\\.5-flash$/.test(m)) || list[0]; }
    catch (e) { out.modelsError = e.message; }
    out.model = ai.model;
    try { out.test = await bridge.request('test', { ai }); } catch (e) { out.testError = e.message; }
    return out;
  })()`);
}
