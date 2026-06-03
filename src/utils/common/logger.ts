import { getName, getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { debug, error, info, trace, warn } from "@tauri-apps/plugin-log";
import { arch, platform } from "@tauri-apps/plugin-os";
import { TauriCommand } from "../../constants/tauri-command";

function safeStrigifyArg(arg: any): string {
  // if is literal
  if (typeof arg === "string" || typeof arg === "number" || typeof arg === "boolean") {
    return arg.toString();
  }
  // if is array
  if (Array.isArray(arg)) {
    return `[${arg.map(safeStrigifyArg).join(", ")}]`;
  }
  // if is nil
  if (arg === null || arg === undefined) {
    return "nil";
  }
  // if is error
  if (arg instanceof Error) {
    return `[error msg=${arg.message} stack=${arg.stack}]`;
  }
  // if is event
  if (arg instanceof Event) {
    return `[event type=${arg.type}]`;
  }
  // if is object
  if (typeof arg === "object") {
    return "[object]";
  }

  return "unknown";
}

function safeStringifyArgs(...args: any[]) {
  return args.map(safeStrigifyArg).join(" ");
}

function logFuncWrapper(fn: (message: string, _options?: any) => Promise<void>) {
  return (...args: any[]) => {
    const message = safeStringifyArgs(...args);
    fn(message);
  };
}

function perf(taskName: string, ...args: any[]) {
  const start = performance.now();
  return function perfEnd(...args2: any[]) {
    const end = performance.now();
    info(`[${taskName}] cost=${(end - start).toFixed(0)}ms ${safeStringifyArgs(...args, ...args2)}`);
  };
}

export const Logger = {
  error: logFuncWrapper(error),
  warn: logFuncWrapper(warn),
  info: logFuncWrapper(info),
  debug: logFuncWrapper(debug),
  trace: logFuncWrapper(trace),
  perf,
};

export function captureGlobalError() {
  const disposeFns: (() => void)[] = [];

  const onError = (ev: ErrorEvent) => {
    Logger.error("[captureGlobalError#error]", ev.message, `${ev.filename}:${ev.lineno}:${ev.colno}`);
  };
  const onReject = (ev: PromiseRejectionEvent) => {
    Logger.error("[captureGlobalError#unhandledrejection]", ev.reason);
  };

  window.addEventListener("error", onError);
  disposeFns.push(() => window.removeEventListener("error", onError));

  window.addEventListener("unhandledrejection", onReject);
  disposeFns.push(() => window.removeEventListener("unhandledrejection", onReject));

  return () => {
    disposeFns.forEach((fn) => fn());
  };
}

export function stringifyRecord(record: Record<string, string | number | boolean>) {
  const arr: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    arr.push(`${k}=${v}`);
  }
  return arr.join(" ");
}

export async function logEnvInfo() {
  const appName = await getName();
  const appVersion = await getVersion();
  const tauriVersion = await getTauriVersion();
  const osName = platform();
  const osArch = arch();
  const webviewVersion = (await invoke(TauriCommand.GetWebviewVersion)) as string;

  const result = stringifyRecord({
    appName,
    appVersion,
    tauriVersion,
    osName,
    osArch,
    webviewVersion,
  });

  Logger.info("[EnvInfo]", result);
}
