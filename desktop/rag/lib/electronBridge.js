/**
 * Registry for the ONE tool (run_show_command) that needs something only
 * the Electron main process can do — drive an actual SSH session in a
 * terminal tab. Historically this was a subprocess RPC (chatOnce.js
 * talking to main.js over stdin/stdout JSON lines) because the RAG agent
 * used to run in a separate child process. Now that agents/fullAgent.js
 * etc. run in-process inside main.js, this collapses to a plain callback
 * registration — no serialization, no pending-request map, just a direct
 * async function call.
 *
 * main.js calls registerLiveCommandHandler(...) once at startup with a
 * function that knows how to actually run a live command (find/open the
 * right terminal tab, enforce the read-only allowlist, type the command
 * into the visible shell, wait for the prompt). tools/agentTools.js's
 * run_show_command implementation calls requestElectronTool(...) exactly
 * as before — its calling code didn't need to change at all.
 */

let handler = null;

export function registerLiveCommandHandler(fn) {
  handler = fn;
}

export function isElectronBridgeAvailable() {
  return typeof handler === 'function';
}

export async function requestElectronTool(tool, args) {
  if (!handler) {
    throw new Error(
      'No live-command handler registered — this only works when running inside the desktop app.'
    );
  }
  return handler(tool, args);
}
