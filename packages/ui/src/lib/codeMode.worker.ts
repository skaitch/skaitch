import { getQuickJS } from '@tootallnate/quickjs-emscripten';
import { CODE_MODE_TOOLS } from '@skaitch/core/ai/tools';
import type { QuickJSDeferredPromise } from '@tootallnate/quickjs-emscripten';

self.onmessage = async ({ data }: MessageEvent<{ code: string }>) => {
  try {
    const quickjs = await getQuickJS();
    const vm = quickjs.newContext();
    let deadline = performance.now() + 1500;
    vm.runtime.setMemoryLimit(32 * 1024 * 1024);
    vm.runtime.setMaxStackSize(512 * 1024);
    vm.runtime.setInterruptHandler(() => performance.now() >= deadline);
    const pending = new Map<number, QuickJSDeferredPromise>();
    const replies: Array<{ id: number; json: string }> = [];
    let wake: (() => void) | undefined;
    self.onmessage = ({ data }) => {
      replies.push(data);
      wake?.();
    };
    try {
      let calls = 0;
      let output: string | undefined;
      let failure: string | undefined;
      vm.newFunction('readTool', (nameHandle, jsonHandle) => {
        if (++calls > 100) return vm.newString('{"error":"Script exceeded 100 tool calls"}');
        if (vm.typeof(nameHandle) !== 'string' || vm.typeof(jsonHandle) !== 'string') {
          return vm.newString('{"error":"Expected a tool name and serializable arguments"}');
        }
        const name = vm.getString(nameHandle);
        if (!CODE_MODE_TOOLS.some(tool => tool === name)) {
          return vm.newString('{"error":"Tool unavailable in Code Mode"}');
        }
        const json = vm.getString(jsonHandle);
        if (json.length > 32_000) return vm.newString('{"error":"Tool arguments are too large"}');
        const args = JSON.parse(json);
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          return vm.newString('{"error":"Tool arguments must be an object"}');
        }
        const deferred = vm.newPromise();
        pending.set(calls, deferred);
        self.postMessage({ id: calls, name, args });
        return deferred.handle;
      }).consume(handle => vm.setProp(vm.global, 'readTool', handle));
      vm.newFunction('finish', (ok, json) => {
        if (vm.typeof(ok) !== 'number' || vm.typeof(json) !== 'string') return;
        const value = vm.getString(json);
        if (vm.getNumber(ok) === 1) output = value;
        else failure = value;
      }).consume(handle => vm.setProp(vm.global, 'finish', handle));

      const start = vm.evalCode(`
        ((read, done, parse, stringify) => {
          const callTool = async (name, args = {}) => parse(await read(name, stringify(args)));
          const run = async () => {
            ${data.code}
          };
          run().then(
            value => done(1, stringify(value ?? null)),
            error => done(0, String(error)),
          ).catch(error => done(0, String(error)));
        })(readTool, finish, JSON.parse, JSON.stringify);
      `, 'chat-script.js');
      if ('value' in start) start.value.dispose();
      else {
        // QuickJS error objects are guest-controlled. Avoid inspecting their properties here.
        start.error.dispose();
        throw new Error('Script could not start. Check the JavaScript syntax.');
      }

      while (true) {
        const jobs = vm.runtime.executePendingJobs();
        if (jobs.error) {
          jobs.error.dispose();
          throw new Error('Script execution interrupted.');
        }
        if (performance.now() >= deadline) throw new Error('Script execution interrupted.');
        if (failure !== undefined || output !== undefined || !pending.size) break;
        if (!replies.length) await new Promise<void>(resolve => { wake = resolve; });
        wake = undefined;
        deadline = performance.now() + 1500;
        for (const { id, json } of replies.splice(0)) {
          const deferred = pending.get(id);
          if (!deferred) continue;
          pending.delete(id);
          vm.newString(json).consume(handle => deferred.resolve(handle));
          deferred.dispose();
        }
      }
      if (failure !== undefined) throw new Error(failure.slice(0, 1000));
      if (output === undefined) throw new Error('Script did not finish.');
      if (output.length > 24_000) throw new Error('Script output is too large; return a smaller result.');
      self.postMessage({ result: JSON.parse(output) });
    } finally {
      for (const deferred of pending.values()) deferred.dispose();
      vm.dispose();
    }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
