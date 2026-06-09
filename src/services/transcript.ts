import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { TauriCommand } from "../constants/tauri-command";
import { BaseService } from "./base";

type TranscriptStatus = "idle" | "starting" | "recording" | "stopping" | "unsupported";
export type TranscriptSource = "microphone" | "system" | "both";
type NativeTranscriptSource = Exclude<TranscriptSource, "both">;
export type TranscriptBackend = "apple" | "funasr-local";

export const TRANSCRIPT_BACKEND_OPTIONS: Array<{ label: string; backend: TranscriptBackend }> = [
  { label: "Apple Speech", backend: "apple" },
  { label: "FunASR", backend: "funasr-local" },
];

export interface FunASRModelBundleOption {
  label: string;
  model: string;
  isLocal: boolean;
}

export const TRANSCRIPT_SOURCE_OPTIONS: Array<{ label: string; source: TranscriptSource }> = [
  { label: "System + Mic", source: "both" },
  { label: "Microphone", source: "microphone" },
  { label: "System Audio", source: "system" },
];

export const TRANSCRIPT_LANGUAGE_OPTIONS = [
  { label: "Auto", locale: "auto" },
  { label: "English", locale: "en-US" },
  { label: "中文", locale: "zh-CN" },
  { label: "粵語", locale: "zh-HK" },
  { label: "日本語", locale: "ja-JP" },
  { label: "한국어", locale: "ko-KR" },
] as const;

export type TranscriptLocale = (typeof TRANSCRIPT_LANGUAGE_OPTIONS)[number]["locale"];

export const TRANSCRIPT_SPEAKER_COUNT_OPTIONS = [
  { label: "Auto", speakerCount: 0 },
  { label: "1", speakerCount: 1 },
  { label: "2", speakerCount: 2 },
  { label: "3", speakerCount: 3 },
  { label: "4", speakerCount: 4 },
  { label: "6", speakerCount: 6 },
  { label: "8", speakerCount: 8 },
] as const;

export type TranscriptSpeakerCount = (typeof TRANSCRIPT_SPEAKER_COUNT_OPTIONS)[number]["speakerCount"];

export const TRANSCRIPT_SILENCE_TIMEOUT_OPTIONS = [
  { label: "Fast (0.8s)", silenceTimeoutMs: 800 },
  { label: "Balanced (1.2s)", silenceTimeoutMs: 1200 },
  { label: "Patient (1.8s)", silenceTimeoutMs: 1800 },
  { label: "Long (2.5s)", silenceTimeoutMs: 2500 },
] as const;

export type TranscriptSilenceTimeoutMs = (typeof TRANSCRIPT_SILENCE_TIMEOUT_OPTIONS)[number]["silenceTimeoutMs"];

export interface TranscriptSegment {
  text: string;
  createdAt: number;
  source: NativeTranscriptSource;
  speaker: string;
}

interface TranscriptState {
  status: TranscriptStatus;
  hasMicrophoneAudio: boolean;
  hasSystemAudio: boolean;
  source: TranscriptSource | "";
  selectedSource: TranscriptSource;
  locale: TranscriptLocale;
  backend: TranscriptBackend;
  funASRModelBundle: string;
  funASRModelBundleOptions: FunASRModelBundleOption[];
  speakerCount: TranscriptSpeakerCount;
  silenceTimeoutMs: TranscriptSilenceTimeoutMs;
  includeTimestamp: boolean;
  includeSpeaker: boolean;
  lastText: string;
  error: string;
}

export type TranscriptSettingsState = Pick<
  TranscriptState,
  | "selectedSource"
  | "locale"
  | "backend"
  | "funASRModelBundle"
  | "speakerCount"
  | "silenceTimeoutMs"
  | "includeTimestamp"
  | "includeSpeaker"
>;

interface TranscriptEvents {
  segment: (segment: TranscriptSegment) => void;
}

type NativeTranscriptEventType = "status" | "segment" | "error" | "debug";

interface NativeTranscriptEvent {
  type: NativeTranscriptEventType;
  source?: NativeTranscriptSource;
  speaker?: string;
  status?: "started" | "stopped";
  text?: string;
  isFinal?: boolean;
  createdAt?: number;
  message?: string;
}

const NATIVE_TRANSCRIPT_EVENT = "native-transcript://event";
const PARTIAL_COMMIT_WAIT = 1800;
const CROSS_SOURCE_DUPLICATE_WINDOW = 8000;

const getDefaultTranscriptLocale = (): TranscriptLocale => {
  return "auto";
};

const getEffectiveTranscriptLocale = (locale: TranscriptLocale) => {
  return locale === "auto" ? navigator.language || "en-US" : locale;
};

const getTranscriptSpeaker = (source: NativeTranscriptSource, speaker?: string) => {
  if (speaker?.trim()) {
    return speaker.trim();
  }

  return source === "microphone" ? "Mic" : "System";
};

const getTranscriptBackendModel = (backend: TranscriptBackend, funASRModelBundle: string) => {
  if (backend === "funasr-local") {
    return funASRModelBundle;
  }

  return "";
};

export class TranscriptService extends BaseService<TranscriptState, TranscriptEvents> {
  protected _state: TranscriptState = {
    status: "idle",
    hasMicrophoneAudio: false,
    hasSystemAudio: false,
    source: "",
    selectedSource: "both",
    locale: getDefaultTranscriptLocale(),
    backend: "apple",
    funASRModelBundle: "",
    funASRModelBundleOptions: [],
    speakerCount: 2,
    silenceTimeoutMs: 1200,
    includeTimestamp: true,
    includeSpeaker: true,
    lastText: "",
    error: "",
  };

  protected _applyFnMap = {};

  private _unlisten: UnlistenFn | null = null;

  private _partialCommitTimers: Partial<Record<NativeTranscriptSource, number>> = {};

  private _lastCommittedText: Partial<Record<NativeTranscriptSource, string>> = {};

  private _recentCommittedSegments: Array<{ text: string; createdAt: number; source: NativeTranscriptSource }> = [];

  get isRecording() {
    return this._state.status === "starting" || this._state.status === "recording";
  }

  setLocale(locale: TranscriptLocale) {
    this.setState("locale", locale);
  }

  setBackend(backend: TranscriptBackend) {
    this.setState("backend", backend);
  }

  setFunASRModelBundle(model: string) {
    this.setState("funASRModelBundle", model);
  }

  setSpeakerCount(speakerCount: TranscriptSpeakerCount) {
    this.setState("speakerCount", speakerCount);
  }

  setSilenceTimeoutMs(silenceTimeoutMs: TranscriptSilenceTimeoutMs) {
    this.setState("silenceTimeoutMs", silenceTimeoutMs);
  }

  setSelectedSource(source: TranscriptSource) {
    this.setState("selectedSource", source);
  }

  setIncludeTimestamp(includeTimestamp: boolean) {
    this.setState("includeTimestamp", includeTimestamp);
  }

  setIncludeSpeaker(includeSpeaker: boolean) {
    this.setState("includeSpeaker", includeSpeaker);
  }

  restoreSettings(settings?: Partial<TranscriptSettingsState>) {
    if (!settings) {
      return;
    }

    const nextState: Partial<TranscriptState> = {};
    if (settings.selectedSource && TRANSCRIPT_SOURCE_OPTIONS.some((option) => option.source === settings.selectedSource)) {
      nextState.selectedSource = settings.selectedSource;
    }
    if (settings.locale && TRANSCRIPT_LANGUAGE_OPTIONS.some((option) => option.locale === settings.locale)) {
      nextState.locale = settings.locale;
    }
    if (settings.backend && TRANSCRIPT_BACKEND_OPTIONS.some((option) => option.backend === settings.backend)) {
      nextState.backend = settings.backend;
    }
    if (typeof settings.funASRModelBundle === "string" && settings.funASRModelBundle.trim()) {
      nextState.funASRModelBundle = settings.funASRModelBundle;
    }
    if (
      typeof settings.speakerCount === "number" &&
      TRANSCRIPT_SPEAKER_COUNT_OPTIONS.some((option) => option.speakerCount === settings.speakerCount)
    ) {
      nextState.speakerCount = settings.speakerCount;
    }
    if (
      typeof settings.silenceTimeoutMs === "number" &&
      TRANSCRIPT_SILENCE_TIMEOUT_OPTIONS.some((option) => option.silenceTimeoutMs === settings.silenceTimeoutMs)
    ) {
      nextState.silenceTimeoutMs = settings.silenceTimeoutMs;
    }
    if (typeof settings.includeTimestamp === "boolean") {
      nextState.includeTimestamp = settings.includeTimestamp;
    }
    if (typeof settings.includeSpeaker === "boolean") {
      nextState.includeSpeaker = settings.includeSpeaker;
    }

    this.setStates(nextState);
  }

  getSettingsState(): TranscriptSettingsState {
    return {
      selectedSource: this._state.selectedSource,
      locale: this._state.locale,
      backend: this._state.backend,
      funASRModelBundle: this._state.funASRModelBundle,
      speakerCount: this._state.speakerCount,
      silenceTimeoutMs: this._state.silenceTimeoutMs,
      includeTimestamp: this._state.includeTimestamp,
      includeSpeaker: this._state.includeSpeaker,
    };
  }

  async refreshFunASRModelBundles() {
    const options = await invoke<FunASRModelBundleOption[]>(TauriCommand.ListFunASRModelBundles);
    const hasSelectedModel = options.some((option) => option.model === this._state.funASRModelBundle);
    if (!hasSelectedModel) {
      this.setState("funASRModelBundle", options[0]?.model ?? "");
    }
    this.setState("funASRModelBundleOptions", options);
  }

  async openFunASRModelsDirectory() {
    await invoke<string>(TauriCommand.OpenFunASRModelsDir);
    await this.refreshFunASRModelBundles();
  }

  async preloadFunASRModel(source: TranscriptSource = this._state.selectedSource) {
    if (this._state.backend !== "funasr-local" || !this._state.funASRModelBundle || this.isRecording) {
      return;
    }

    await invoke(TauriCommand.PreloadFunASRModel, {
      source,
      locale: getEffectiveTranscriptLocale(this._state.locale),
      model: this._state.funASRModelBundle,
      speakerCount: this._state.speakerCount,
      silenceTimeoutMs: this._state.silenceTimeoutMs,
    });
  }

  async prepareFunASRModel(source: TranscriptSource = this._state.selectedSource) {
    if (this._state.backend !== "funasr-local" || this.isRecording) {
      return;
    }

    const hasLoadedSelectedModel = this._state.funASRModelBundleOptions.some(
      (option) => option.model === this._state.funASRModelBundle,
    );
    if (!this._state.funASRModelBundle || !hasLoadedSelectedModel) {
      await this.refreshFunASRModelBundles();
    }

    await this.preloadFunASRModel(source);
  }

  async shutdownNativeTranscript() {
    await invoke(TauriCommand.ShutdownNativeTranscript);
  }

  async start(source: TranscriptSource = this._state.selectedSource) {
    if (this.isRecording) {
      return;
    }
    if (this._state.backend === "funasr-local" && !this._state.funASRModelBundle) {
      await this.refreshFunASRModelBundles();
    }
    if (this._state.backend === "funasr-local" && !this._state.funASRModelBundle) {
      throw new Error("Add a complete FunASR model bundle before starting transcript with FunASR.");
    }

    this.setStates({
      status: "starting",
      hasMicrophoneAudio: false,
      hasSystemAudio: false,
      source,
      lastText: "",
      error: "",
    });
    this._lastCommittedText = {};
    this._recentCommittedSegments = [];
    this._clearPartialCommitTimers();

    try {
      await this._listen();
      await invoke(TauriCommand.StartNativeTranscript, {
        source,
        locale: getEffectiveTranscriptLocale(this._state.locale),
        backend: this._state.backend,
        model: getTranscriptBackendModel(this._state.backend, this._state.funASRModelBundle),
        speakerCount: this._state.speakerCount,
        silenceTimeoutMs: this._state.silenceTimeoutMs,
      });

      this.setStates({
        status: "recording",
        hasMicrophoneAudio: source === "microphone" || source === "both",
        hasSystemAudio: source === "system" || source === "both",
        source,
      });
    } catch (error) {
      this._cleanupListener();
      this.setStates({
        status: "idle",
        hasMicrophoneAudio: false,
        hasSystemAudio: false,
        source: "",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  stop() {
    if (this._state.status === "idle") {
      return;
    }

    this.setState("status", "stopping");
    this._clearPartialCommitTimers();
    void invoke(TauriCommand.StopNativeTranscript).finally(() => {
      this._cleanupListener();
      this.setStates({
        status: "idle",
        hasMicrophoneAudio: false,
        hasSystemAudio: false,
        source: "",
        lastText: "",
      });
    });
  }

  dispose() {
    this.stop();
    void this.shutdownNativeTranscript();
  }

  private async _listen() {
    this._cleanupListener();
    this._unlisten = await listen<NativeTranscriptEvent>(NATIVE_TRANSCRIPT_EVENT, (event) => {
      this._handleNativeEvent(event.payload);
    });
  }

  private _cleanupListener() {
    this._clearPartialCommitTimers();
    this._unlisten?.();
    this._unlisten = null;
  }

  private _clearPartialCommitTimers(source?: NativeTranscriptSource) {
    if (source) {
      if (this._partialCommitTimers[source]) {
        window.clearTimeout(this._partialCommitTimers[source]);
        delete this._partialCommitTimers[source];
      }
      return;
    }

    for (const activeSource of Object.keys(this._partialCommitTimers) as NativeTranscriptSource[]) {
      window.clearTimeout(this._partialCommitTimers[activeSource]);
      delete this._partialCommitTimers[activeSource];
    }
  }

  private _handleNativeEvent(event: NativeTranscriptEvent) {
    if (event.type === "status") {
      this._handleStatusEvent(event);
      return;
    }

    if (event.type === "error") {
      const message = event.message || "Native transcript failed.";
      this._cleanupListener();
      this.setStates({
        status: "idle",
        hasMicrophoneAudio: false,
        hasSystemAudio: false,
        source: "",
        error: message,
      });
      void invoke(TauriCommand.StopNativeTranscript);
      return;
    }

    if (event.type === "debug") {
      return;
    }

    const text = event.text?.trim();
    const source = event.source;
    if (!text || !source) {
      return;
    }

    this.setState("lastText", text);
    if (event.isFinal) {
      this._clearPartialCommitTimers(source);
      this._commitTranscriptText(text, event.createdAt ?? Date.now(), source, event.speaker);
      return;
    }

    this._clearPartialCommitTimers(source);
    this._partialCommitTimers[source] = window.setTimeout(() => {
      this._commitTranscriptText(text, event.createdAt ?? Date.now(), source, event.speaker);
    }, PARTIAL_COMMIT_WAIT);
  }

  private _handleStatusEvent(event: NativeTranscriptEvent) {
    if (event.status === "started") {
      if (this._state.source === "both") {
        this.setStates({
          status: "recording",
          hasMicrophoneAudio: this._state.hasMicrophoneAudio || event.source === "microphone",
          hasSystemAudio: this._state.hasSystemAudio || event.source === "system",
          source: "both",
        });
        if (event.source) {
          this._lastCommittedText[event.source] = "";
        }
        return;
      }

      this.setStates({
        status: "recording",
        hasMicrophoneAudio: event.source === "microphone",
        hasSystemAudio: event.source === "system",
        source: event.source ?? this._state.source,
      });
      if (event.source) {
        this._lastCommittedText[event.source] = "";
      }
      return;
    }

    if (event.status === "stopped") {
      this._cleanupListener();
      this.setStates({
        status: "idle",
        hasMicrophoneAudio: false,
        hasSystemAudio: false,
        source: "",
        lastText: "",
      });
    }
  }

  private _commitTranscriptText(text: string, createdAt: number, source: NativeTranscriptSource, speaker?: string) {
    const nextText = this._getNewTranscriptText(source, text);
    if (!nextText) {
      return;
    }
    if (this._isCrossSourceDuplicate(nextText, createdAt, source)) {
      this._lastCommittedText[source] = text;
      return;
    }

    this._lastCommittedText[source] = text;
    this._rememberCommittedSegment(nextText, createdAt, source);
    this._emitter.emit("segment", {
      text: this._formatTranscriptSegment(nextText, createdAt, source, speaker),
      createdAt,
      source,
      speaker: getTranscriptSpeaker(source, speaker),
    });
  }

  private _getNewTranscriptText(source: NativeTranscriptSource, text: string) {
    const lastCommittedText = this._lastCommittedText[source] ?? "";

    if (!lastCommittedText) {
      return text;
    }

    if (text === lastCommittedText) {
      return "";
    }

    if (text.startsWith(lastCommittedText)) {
      return text
        .slice(lastCommittedText.length)
        .replace(/^[\s,.;:，。！？、]+/, "")
        .trim();
    }

    return text;
  }

  private _formatTranscriptSegment(text: string, createdAt: number, source: NativeTranscriptSource, speaker?: string) {
    const parts: string[] = [];
    if (this._state.includeTimestamp) {
      const time = new Date(createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      parts.push(`[${time}]`);
    }
    if (this._state.includeSpeaker) {
      parts.push(`${getTranscriptSpeaker(source, speaker)}:`);
    }

    return parts.length ? `${parts.join(" ")} ${text}` : text;
  }

  private _isCrossSourceDuplicate(text: string, createdAt: number, source: NativeTranscriptSource) {
    if (this._state.source !== "both") {
      return false;
    }

    const normalizedText = this._normalizeTranscriptText(text);
    if (!normalizedText) {
      return false;
    }

    return this._recentCommittedSegments.some((segment) => {
      if (segment.source === source || Math.abs(createdAt - segment.createdAt) > CROSS_SOURCE_DUPLICATE_WINDOW) {
        return false;
      }

      const normalizedSegmentText = this._normalizeTranscriptText(segment.text);
      if (!normalizedSegmentText) {
        return false;
      }

      return (
        normalizedText === normalizedSegmentText ||
        (Math.min(normalizedText.length, normalizedSegmentText.length) >= 12 &&
          (normalizedText.includes(normalizedSegmentText) || normalizedSegmentText.includes(normalizedText)))
      );
    });
  }

  private _rememberCommittedSegment(text: string, createdAt: number, source: NativeTranscriptSource) {
    this._recentCommittedSegments.push({ text, createdAt, source });
    this._recentCommittedSegments = this._recentCommittedSegments.filter(
      (segment) => createdAt - segment.createdAt <= CROSS_SOURCE_DUPLICATE_WINDOW,
    );
  }

  private _normalizeTranscriptText(text: string) {
    return text
      .toLowerCase()
      .replace(/[\s,.;:!?()[\]{}'"`，。！？、；：“”‘’（）【】《》]+/g, "")
      .trim();
  }
}
