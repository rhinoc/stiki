#!/usr/bin/env python3
import contextlib
import json
import math
import os
import re
import sys
import tempfile
import time
import traceback

MODEL = None
SPK_MODEL = None
MODEL_NAME = ""
SPEAKER_PROFILES = []
SPEAKER_CANDIDATES = []
NEXT_SPEAKER_INDEX = 1
REQUIRED_MODEL_DIRS = {
    "asr": "asr",
    "vad": "vad",
    "punc": "punc",
    "speaker": "speaker",
}
SPEAKER_SIMILARITY_THRESHOLD = 0.72
SPEAKER_MIN_SEGMENT_MS = 900
SPEAKER_CENTROID_ALPHA = 0.18
SPEAKER_MAX_PROFILES = 8
SPEAKER_PROFILE_UPDATE_THRESHOLD = 0.80
SPEAKER_CREATE_MIN_SEGMENT_MS = 1500
SPEAKER_CANDIDATE_THRESHOLD = 0.70
SPEAKER_CANDIDATE_PROMOTION_COUNT = 2
SPEAKER_MAX_CANDIDATES = 8


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


def resolve_model_bundle(model_name):
    if not model_name:
        raise ValueError("FunASR model bundle path is required.")

    bundle_path = os.path.abspath(os.path.expanduser(model_name))
    if not os.path.isdir(bundle_path):
        raise ValueError(f"FunASR model bundle does not exist or is not a directory: {bundle_path}")

    paths = {}
    missing = []
    for key, dirname in REQUIRED_MODEL_DIRS.items():
        path = os.path.join(bundle_path, dirname)
        if os.path.isdir(path):
            paths[key] = path
        else:
            missing.append(dirname)

    if missing:
        raise ValueError(
            "FunASR model bundle is incomplete. "
            f"Missing required subdirectories in {bundle_path}: {', '.join(missing)}. "
            "Expected layout: asr/, vad/, punc/, speaker/."
        )

    return bundle_path, paths


def load_model(model_name):
    global MODEL, SPK_MODEL, MODEL_NAME, SPEAKER_PROFILES, SPEAKER_CANDIDATES, NEXT_SPEAKER_INDEX
    bundle_path, paths = resolve_model_bundle(model_name)

    if MODEL is not None and MODEL_NAME == bundle_path:
        return MODEL

    SPEAKER_PROFILES = []
    SPEAKER_CANDIDATES = []
    NEXT_SPEAKER_INDEX = 1
    started_at = time.perf_counter()
    print(
        "funasr loading local model bundle "
        f"bundle={bundle_path} asr={paths['asr']} vad={paths['vad']} punc={paths['punc']} speaker={paths['speaker']}",
        file=sys.stderr,
        flush=True,
    )
    with contextlib.redirect_stdout(sys.stderr):
        from funasr import AutoModel

        MODEL = AutoModel(
            model=paths["asr"],
            vad_model=paths["vad"],
            vad_kwargs={"max_single_segment_time": 30000},
            punc_model=paths["punc"],
            spk_model=paths["speaker"],
            spk_mode="vad_segment",
            trust_remote_code=True,
            disable_update=True,
            disable_pbar=True,
            device="cpu",
        )
        SPK_MODEL = AutoModel(
            model=paths["speaker"],
            trust_remote_code=True,
            disable_update=True,
            disable_pbar=True,
            device="cpu",
        )
    MODEL_NAME = bundle_path
    print(
        f"funasr model bundle loaded in {time.perf_counter() - started_at:.3f}s bundle={bundle_path}",
        file=sys.stderr,
        flush=True,
    )
    return MODEL


TAG_RE = re.compile(r"<\|([^|]+)\|>")


def clean_text(raw_text):
    return TAG_RE.sub("", raw_text).strip()


def normalize_speaker(value):
    if value is None:
        return None

    if isinstance(value, int):
        return f"Speaker {value + 1}"

    text = str(value).strip()
    if not text:
        return None

    if text.isdigit():
        return f"Speaker {int(text) + 1}"

    if text.lower().startswith("speaker"):
        return text

    return f"Speaker {text}"


def normalize_ms(value):
    if value is None:
        return None

    try:
        return max(0, int(float(value)))
    except (TypeError, ValueError):
        return None


def vector_from_embedding(value):
    if value is None:
        return None

    try:
        if hasattr(value, "detach"):
            value = value.detach().cpu().reshape(-1).tolist()
        elif hasattr(value, "reshape") and hasattr(value, "tolist"):
            value = value.reshape(-1).tolist()
        elif hasattr(value, "tolist"):
            value = value.tolist()

        vector = []

        def append_numbers(item):
            if isinstance(item, (list, tuple)):
                for child in item:
                    append_numbers(child)
                return
            vector.append(float(item))

        append_numbers(value)
        norm = math.sqrt(sum(item * item for item in vector))
        if not math.isfinite(norm) or norm <= 0:
            return None
        return [item / norm for item in vector]
    except Exception as error:
        print(f"funasr speaker embedding normalization failed: {error}", file=sys.stderr, flush=True)
        return None


def cosine_similarity(left, right):
    try:
        return sum(left_item * right_item for left_item, right_item in zip(left, right))
    except Exception:
        return -1.0


def normalized_average(left, right, alpha):
    updated = [(1.0 - alpha) * old + alpha * new for old, new in zip(left, right)]
    norm = math.sqrt(sum(item * item for item in updated))
    if norm <= 0:
        return left
    return [item / norm for item in updated]


def best_embedding_match(embedding, profiles):
    best_profile = None
    best_similarity = -1.0
    for profile in profiles:
        similarity = cosine_similarity(embedding, profile["centroid"])
        if similarity > best_similarity:
            best_similarity = similarity
            best_profile = profile
    return best_profile, best_similarity


def segment_duration_ms(segment):
    start_ms = segment.get("startMs")
    end_ms = segment.get("endMs")
    if start_ms is None or end_ms is None or end_ms <= start_ms:
        return None
    return end_ms - start_ms


def effective_speaker_limit(speaker_count):
    count = normalize_speaker_count(speaker_count)
    if count <= 0:
        return SPEAKER_MAX_PROFILES
    return count


def normalize_speaker_count(value):
    try:
        count = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return min(max(count, 0), SPEAKER_MAX_PROFILES)


def vad_merge_length_seconds(speaker_count):
    count = normalize_speaker_count(speaker_count)
    if count <= 0:
        return 6
    if count <= 2:
        return 8
    if count <= 4:
        return 6
    return 5


def audio_duration_ms(audio_path):
    try:
        import soundfile as sf

        info = sf.info(audio_path)
        if info.samplerate <= 0:
            return None
        return int(info.frames / info.samplerate * 1000)
    except Exception:
        return None


def make_speaker_input(audio_path, start_ms, end_ms):
    if start_ms is None or end_ms is None or end_ms <= start_ms:
        duration = audio_duration_ms(audio_path)
        if duration is not None and duration < SPEAKER_MIN_SEGMENT_MS:
            return None, None
        return audio_path, None

    duration_ms = end_ms - start_ms
    if duration_ms < SPEAKER_MIN_SEGMENT_MS:
        return None, None

    try:
        import soundfile as sf

        info = sf.info(audio_path)
        start_frame = max(0, int(info.samplerate * start_ms / 1000))
        stop_frame = min(info.frames, int(info.samplerate * end_ms / 1000))
        if stop_frame <= start_frame:
            return None, None

        data, samplerate = sf.read(audio_path, start=start_frame, stop=stop_frame, dtype="float32")
        if len(data) <= 0:
            return None, None

        temp = tempfile.NamedTemporaryFile(
            mode="wb",
            suffix=".wav",
            prefix="stiki-speaker-",
            dir=os.path.dirname(audio_path),
            delete=False,
        )
        temp.close()
        sf.write(temp.name, data, samplerate)
        return temp.name, temp.name
    except Exception as error:
        print(f"funasr speaker crop failed: {error}", file=sys.stderr, flush=True)
        return None, None


def extract_speaker_embedding(audio_path, start_ms, end_ms):
    if SPK_MODEL is None:
        return None

    speaker_input, cleanup_path = make_speaker_input(audio_path, start_ms, end_ms)
    if speaker_input is None:
        return None

    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = SPK_MODEL.generate(input=speaker_input)
        item = result[0] if result else {}
        embedding = item.get("spk_embedding")
        if embedding is None:
            embedding = item.get("embedding")
        return vector_from_embedding(embedding)
    except Exception as error:
        print(f"funasr speaker embedding failed: {error}", file=sys.stderr, flush=True)
        return None
    finally:
        if cleanup_path is not None:
            try:
                os.remove(cleanup_path)
            except OSError:
                pass


def add_speaker_profile(embedding):
    global NEXT_SPEAKER_INDEX

    label = f"Speaker {NEXT_SPEAKER_INDEX}"
    NEXT_SPEAKER_INDEX += 1
    SPEAKER_PROFILES.append({
        "label": label,
        "centroid": embedding,
        "count": 1,
    })
    return label


def promote_or_defer_candidate(embedding, best_profile, best_similarity):
    candidate, candidate_similarity = best_embedding_match(embedding, SPEAKER_CANDIDATES)
    if candidate is not None and candidate_similarity >= SPEAKER_CANDIDATE_THRESHOLD:
        candidate["centroid"] = normalized_average(candidate["centroid"], embedding, SPEAKER_CENTROID_ALPHA)
        candidate["count"] += 1
        if candidate["count"] >= SPEAKER_CANDIDATE_PROMOTION_COUNT:
            SPEAKER_CANDIDATES.remove(candidate)
            return add_speaker_profile(candidate["centroid"]), candidate_similarity, "promoted"
        if best_profile is not None:
            return best_profile["label"], best_similarity, "candidate"
        return None, candidate_similarity, "candidate"

    SPEAKER_CANDIDATES.append({
        "centroid": embedding,
        "count": 1,
    })
    if len(SPEAKER_CANDIDATES) > SPEAKER_MAX_CANDIDATES:
        SPEAKER_CANDIDATES.pop(0)
    if best_profile is not None:
        return best_profile["label"], best_similarity, "candidate"
    return None, candidate_similarity, "candidate"


def assign_global_speaker(embedding, local_speaker, duration_ms, speaker_count):
    if embedding is None:
        return None, None, "no-embedding"

    max_profiles = effective_speaker_limit(speaker_count)
    best_profile, best_similarity = best_embedding_match(embedding, SPEAKER_PROFILES)

    if best_profile is not None and best_similarity >= SPEAKER_SIMILARITY_THRESHOLD:
        if best_similarity >= SPEAKER_PROFILE_UPDATE_THRESHOLD:
            best_profile["centroid"] = normalized_average(best_profile["centroid"], embedding, SPEAKER_CENTROID_ALPHA)
        best_profile["count"] += 1
        return best_profile["label"], best_similarity, "matched"

    if len(SPEAKER_PROFILES) >= max_profiles and best_profile is not None:
        return best_profile["label"], best_similarity, "limited"

    if not SPEAKER_PROFILES:
        return add_speaker_profile(embedding), best_similarity, "created"

    if duration_ms is not None and duration_ms < SPEAKER_CREATE_MIN_SEGMENT_MS and best_profile is not None:
        return best_profile["label"], best_similarity, "short"

    if speaker_count:
        return add_speaker_profile(embedding), best_similarity, "created"

    return promote_or_defer_candidate(embedding, best_profile, best_similarity)


def stabilize_segment_speakers(audio_path, segments, speaker_count):
    local_to_global = {}
    stabilized = []

    for segment in segments:
        local_speaker = segment.get("speaker")
        duration_ms = segment_duration_ms(segment)
        embedding = extract_speaker_embedding(audio_path, segment.get("startMs"), segment.get("endMs"))
        speaker, similarity, decision = assign_global_speaker(embedding, local_speaker, duration_ms, speaker_count)
        if speaker is not None and local_speaker is not None:
            local_to_global[local_speaker] = speaker
        if speaker is None and local_speaker in local_to_global:
            speaker = local_to_global[local_speaker]
        if speaker is None:
            speaker = local_speaker

        next_segment = dict(segment)
        next_segment["speaker"] = speaker
        stabilized.append(next_segment)

        if embedding is not None:
            similarity_text = "new" if similarity is None or similarity < 0 else f"{similarity:.3f}"
            print(
                f"funasr speaker match local={local_speaker or '-'} global={speaker or '-'} similarity={similarity_text} decision={decision} profiles={len(SPEAKER_PROFILES)} candidates={len(SPEAKER_CANDIDATES)} speakerCount={speaker_count or 'auto'}",
                file=sys.stderr,
                flush=True,
            )

    return stabilized


def build_segments(item, fallback_text):
    segments = []
    for sentence in item.get("sentence_info") or []:
        text = clean_text(sentence.get("text") or sentence.get("sentence") or "")
        if not text:
            continue

        segments.append({
            "text": text,
            "speaker": normalize_speaker(sentence.get("spk")),
            "startMs": normalize_ms(sentence.get("start")),
            "endMs": normalize_ms(sentence.get("end")),
        })

    if segments:
        return segments

    text = clean_text(fallback_text)
    if not text:
        return []

    return [{
        "text": text,
        "speaker": normalize_speaker(item.get("spk")),
        "startMs": normalize_ms(item.get("start")),
        "endMs": normalize_ms(item.get("end")),
    }]


def transcribe(request):
    model_name = request.get("model") or MODEL_NAME
    if not model_name:
        raise ValueError("FunASR model bundle path is required.")

    audio_path = request["path"]
    language = normalize_language(request.get("language", "auto"))
    speaker_count = normalize_speaker_count(request.get("speakerCount"))
    merge_length_s = vad_merge_length_seconds(speaker_count)

    model = load_model(model_name)
    started_at = time.perf_counter()
    print(
        f"funasr transcribe config speakerCount={speaker_count or 'auto'} mergeLengthS={merge_length_s}",
        file=sys.stderr,
        flush=True,
    )
    with contextlib.redirect_stdout(sys.stderr):
        result = model.generate(
            input=audio_path,
            cache={},
            language=language,
            use_itn=True,
            ban_emo_unk=True,
            output_timestamp=True,
            return_time_stamps=True,
            temperature=0.0,
            compression_ratio_threshold=2.4,
            logprob_threshold=-1.0,
            no_speech_threshold=0.6,
            batch_size_s=60,
            merge_vad=True,
            merge_length_s=merge_length_s,
            disable_pbar=True,
        )

    duration_ms = int((time.perf_counter() - started_at) * 1000)
    item = result[0] if result else {}
    raw_text = item.get("text", "")
    tags = TAG_RE.findall(raw_text)
    segments = build_segments(item, raw_text)
    segments = stabilize_segment_speakers(audio_path, segments, speaker_count)
    text = " ".join(segment["text"] for segment in segments).strip()
    is_speech = "Speech" in tags or bool(segments)

    return {
        "type": "result",
        "id": request.get("id"),
        "text": text,
        "segments": segments,
        "rawText": raw_text,
        "tags": tags,
        "isSpeech": is_speech,
        "durationMs": duration_ms,
        "mergeLengthS": merge_length_s,
    }


def preload(request):
    model_name = request.get("model") or MODEL_NAME
    if not model_name:
        raise ValueError("FunASR model bundle path is required.")

    started_at = time.perf_counter()
    load_model(model_name)
    return {
        "type": "loaded",
        "id": request.get("id"),
        "durationMs": int((time.perf_counter() - started_at) * 1000),
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
            if request.get("type") == "load":
                write_event(preload(request))
                continue
            if request.get("type") != "transcribe":
                continue
            write_event(transcribe(request))
        except Exception as error:
            write_event({
                "type": "error",
                "id": request.get("id") if "request" in locals() else None,
                "message": f"{error}\n{traceback.format_exc()}",
            })


if __name__ == "__main__":
    main()
