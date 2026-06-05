#!/usr/bin/env python3
import contextlib
import json
import re
import sys
import time

MODEL = None
MODEL_NAME = ""


def write_event(event):
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def normalize_language(language):
    if language in ("zh-CN", "zh-HK", "zh-TW", "zh"):
        return "zh"
    if language in ("en-US", "en-GB", "en"):
        return "en"
    if language in ("ja-JP", "ja"):
        return "ja"
    if language in ("ko-KR", "ko"):
        return "ko"
    return "auto"


def load_model(model_name):
    global MODEL, MODEL_NAME
    if not model_name:
        raise ValueError("SenseVoice model path is required.")

    if MODEL is not None and MODEL_NAME == model_name:
        return MODEL

    started_at = time.perf_counter()
    with contextlib.redirect_stdout(sys.stderr):
        from funasr import AutoModel

        MODEL = AutoModel(
            model=model_name,
            trust_remote_code=True,
            disable_update=True,
            device="cpu",
        )
    MODEL_NAME = model_name
    print(f"sensevoice model loaded in {time.perf_counter() - started_at:.3f}s model={model_name}", file=sys.stderr)
    return MODEL


TAG_RE = re.compile(r"<\|([^|]+)\|>")


def clean_text(raw_text):
    return TAG_RE.sub("", raw_text).strip()


def transcribe(request):
    model_name = request.get("model") or MODEL_NAME
    if not model_name:
        raise ValueError("SenseVoice model path is required.")

    audio_path = request["path"]
    language = normalize_language(request.get("language", "auto"))

    model = load_model(model_name)
    started_at = time.perf_counter()
    with contextlib.redirect_stdout(sys.stderr):
        result = model.generate(
            input=audio_path,
            language=language,
            use_itn=True,
            ban_emo_unk=True,
        )

    duration_ms = int((time.perf_counter() - started_at) * 1000)
    item = result[0] if result else {}
    raw_text = item.get("text", "")
    tags = TAG_RE.findall(raw_text)
    text = clean_text(raw_text)
    is_speech = "Speech" in tags or bool(text)

    return {
        "type": "result",
        "id": request.get("id"),
        "text": text,
        "rawText": raw_text,
        "tags": tags,
        "isSpeech": is_speech,
        "durationMs": duration_ms,
    }


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            if request.get("type") == "stop":
                break
            if request.get("type") != "transcribe":
                continue
            write_event(transcribe(request))
        except Exception as error:
            write_event({
                "type": "error",
                "id": request.get("id") if "request" in locals() else None,
                "message": str(error),
            })


if __name__ == "__main__":
    main()
