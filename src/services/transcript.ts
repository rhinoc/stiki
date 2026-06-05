import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { TauriCommand } from "../constants/tauri-command";
import { BaseService } from "./base";

type TranscriptStatus = "idle" | "starting" | "recording" | "stopping" | "unsupported";
export type TranscriptSource = "microphone" | "system" | "both";
type NativeTranscriptSource = Exclude<TranscriptSource, "both">;
export type TranscriptBackend = "apple" | "sensevoice-local";

export const TRANSCRIPT_BACKEND_OPTIONS: Array<{ label: string; backend: TranscriptBackend }> = [
  { label: "Apple Speech", backend: "apple" },
  { label: "SenseVoice", backend: "sensevoice-local" },
];

export interface SenseVoiceModelOption {
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
  senseVoiceModel: string;
  senseVoiceModelOptions: SenseVoiceModelOption[];
  includeTimestamp: boolean;
  includeSpeaker: boolean;
  lastText: string;
  error: string;
}

export type TranscriptSettingsState = Pick<
  TranscriptState,
  "selectedSource" | "locale" | "backend" | "senseVoiceModel" | "includeTimestamp" | "includeSpeaker"
>;

interface TranscriptEvents {
  segment: (segment: TranscriptSegment) => void;
}

type NativeTranscriptEventType = "status" | "segment" | "error" | "debug";

interface NativeTranscriptEvent {
  type: NativeTranscriptEventType;
  source?: NativeTranscriptSource;
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

const getTranscriptSpeaker = (source: NativeTranscriptSource) => {
  return source === "microphone" ? "Mic" : "System";
};

const getTranscriptBackendModel = (backend: TranscriptBackend, senseVoiceModel: string) => {
  if (backend === "sensevoice-local") {
    return senseVoiceModel;
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
    senseVoiceModel: "",
    senseVoiceModelOptions: [],
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

  setSenseVoiceModel(model: string) {
    this.setState("senseVoiceModel", model);
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
    if (typeof settings.senseVoiceModel === "string" && settings.senseVoiceModel.trim()) {
      nextState.senseVoiceModel = settings.senseVoiceModel;
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
      senseVoiceModel: this._state.senseVoiceModel,
      includeTimestamp: this._state.includeTimestamp,
      includeSpeaker: this._state.includeSpeaker,
    };
  }

  async refreshSenseVoiceModels() {
    const options = await invoke<SenseVoiceModelOption[]>(TauriCommand.ListSenseVoiceModels);
    const hasSelectedModel = options.some((option) => option.model === this._state.senseVoiceModel);
    if (!hasSelectedModel) {
      this.setState("senseVoiceModel", options[0]?.model ?? "");
    }
    this.setState("senseVoiceModelOptions", options);
  }

  async openSenseVoiceModelsDirectory() {
    await invoke<string>(TauriCommand.OpenSenseVoiceModelsDir);
    await this.refreshSenseVoiceModels();
  }

  async start(source: TranscriptSource = this._state.selectedSource) {
    if (this.isRecording) {
      return;
    }
    if (this._state.backend === "sensevoice-local" && !this._state.senseVoiceModel) {
      await this.refreshSenseVoiceModels();
    }
    if (this._state.backend === "sensevoice-local" && !this._state.senseVoiceModel) {
      throw new Error("Add a SenseVoice model folder or symlink before starting transcript with SenseVoice.");
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
        model: getTranscriptBackendModel(this._state.backend, this._state.senseVoiceModel),
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
      this._commitTranscriptText(text, event.createdAt ?? Date.now(), source);
      return;
    }

    this._clearPartialCommitTimers(source);
    this._partialCommitTimers[source] = window.setTimeout(() => {
      this._commitTranscriptText(text, event.createdAt ?? Date.now(), source);
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

  private _commitTranscriptText(text: string, createdAt: number, source: NativeTranscriptSource) {
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
      text: this._formatTranscriptSegment(nextText, createdAt, source),
      createdAt,
      source,
      speaker: getTranscriptSpeaker(source),
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

  private _formatTranscriptSegment(text: string, createdAt: number, source: NativeTranscriptSource) {
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
      parts.push(`${getTranscriptSpeaker(source)}:`);
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
