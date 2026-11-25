"""AutoKlipper local AI helper. Runs inside the AutoKlipper-managed virtual environment.

Everything runs on this computer. The only network use is the two download commands,
which the user starts on purpose. Progress goes to stdout as `CLIPIT_PROGRESS <percent>`,
results go to a JSON file, failures end with `CLIPIT_ERROR: <message>` on stderr.
"""
import argparse
import json
import os
import sys
import tarfile
import urllib.request
import wave

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

SEGMENTATION_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/"
    "sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
)
EMBEDDING_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/"
    "nemo_en_titanet_small.onnx"
)
MODELS = ("tiny", "base", "small", "medium", "large-v3")
FACE_MODEL_URL = (
    "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx"
)
# The exact file AutoKlipper was tested with. Anything else is rejected.
FACE_MODEL_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"


def progress(value):
    print(f"CLIPIT_PROGRESS {max(0.0, min(99.0, value)):.1f}", flush=True)


def version_of(name):
    try:
        from importlib.metadata import version

        return version(name)
    except Exception:
        return None


def cmd_check(_args):
    gpu = 0
    try:
        import ctranslate2

        gpu = ctranslate2.get_cuda_device_count()
    except Exception:
        pass
    print(
        json.dumps(
            {
                "python": sys.version.split()[0],
                "fasterWhisper": version_of("faster-whisper"),
                "sherpaOnnx": version_of("sherpa-onnx"),
                "opencv": version_of("opencv-python-headless"),
                "gpus": gpu,
            }
        )
    )


def cmd_download_model(args):
    if args.model not in MODELS:
        raise SystemExit(f"Unknown model {args.model}")
    from faster_whisper import download_model

    progress(1)
    download_model(args.model, output_dir=args.out)
    if not os.path.isfile(os.path.join(args.out, "model.bin")):
        raise RuntimeError("The download finished without a model file.")
    progress(99)


def fetch(url, dest, start, end):
    part = dest + ".part"

    def hook(blocks, block_size, total):
        if total > 0:
            progress(start + (end - start) * min(1.0, blocks * block_size / total))

    urllib.request.urlretrieve(url, part, hook)
    os.replace(part, dest)


def cmd_download_speaker(args):
    os.makedirs(args.out, exist_ok=True)
    archive = os.path.join(args.out, "segmentation.tar.bz2")
    fetch(SEGMENTATION_URL, archive, 1, 20)
    # Extract only the one file we use, by exact name, so the archive cannot write anywhere else.
    with tarfile.open(archive, "r:bz2") as tar:
        member = next(
            m for m in tar.getmembers() if m.isfile() and m.name.endswith("/model.int8.onnx")
        )
        with tar.extractfile(member) as src, open(os.path.join(args.out, "segmentation.onnx"), "wb") as dst:
            dst.write(src.read())
    os.remove(archive)
    fetch(EMBEDDING_URL, os.path.join(args.out, "embedding.onnx"), 20, 99)


def cmd_download_face(args):
    import hashlib

    os.makedirs(args.out, exist_ok=True)
    dest = os.path.join(args.out, "yunet.onnx")
    fetch(FACE_MODEL_URL, dest, 1, 95)
    with open(dest, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest != FACE_MODEL_SHA256:
        os.remove(dest)
        raise RuntimeError("The downloaded face model does not match the expected file.")


def cmd_track(args):
    """Find the main face a few times a second between two points of a video."""
    import cv2

    video = cv2.VideoCapture(args.video)
    if not video.isOpened():
        raise RuntimeError("OpenCV could not open this video.")
    width = int(video.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(video.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scale = min(1.0, 960.0 / max(width, 1))
    size = (max(1, int(width * scale)), max(1, int(height * scale)))
    detector = cv2.FaceDetectorYN.create(args.model, "", size, 0.7, 0.3, 20)

    video.set(cv2.CAP_PROP_POS_MSEC, args.start * 1000.0)
    step = 1.0 / args.fps
    next_at, samples, previous = args.start, [], None
    span = max(args.end - args.start, 0.1)
    while True:
        at = video.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        if not video.grab() or at > args.end:
            break
        if at + 1e-3 < next_at:
            continue
        next_at += step
        ok, frame = video.retrieve()
        if not ok:
            continue
        if scale < 1.0:
            frame = cv2.resize(frame, size)
        _, faces = detector.detect(frame)
        best = None
        for f in faces if faces is not None else []:
            cx = float(f[0] + f[2] / 2) / size[0]
            area = float(f[2] * f[3]) / (size[0] * size[1])
            # Prefer big faces, and stay with the one followed so far.
            near = 1.0 if previous is None else max(0.15, 1.0 - 2.0 * abs(cx - previous))
            weight = area * near * float(f[14])
            if best is None or weight > best[0]:
                best = (weight, cx, area)
        if best:
            previous = best[1]
        samples.append({"t": round(at, 3), "cx": round(best[1], 4) if best else None})
        progress((at - args.start) / span * 99)
    video.release()
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"width": width, "height": height, "samples": samples}, f)


def read_wav(path):
    import numpy as np

    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            raise RuntimeError("Expected 16-bit mono audio.")
        rate = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    return data.astype("float32") / 32768.0, rate


def speakers_for(audio_path, speaker_dir):
    import sherpa_onnx

    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=os.path.join(speaker_dir, "segmentation.onnx")
            ),
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=os.path.join(speaker_dir, "embedding.onnx")),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=-1, threshold=0.8),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    sd = sherpa_onnx.OfflineSpeakerDiarization(config)
    samples, rate = read_wav(audio_path)
    if rate != sd.sample_rate:
        raise RuntimeError(f"Speaker model expects {sd.sample_rate} Hz audio.")
    return [(r.start, r.end, int(r.speaker)) for r in sd.process(samples).sort_by_start_time()]


def assign_speaker(start, end, turns):
    best, best_overlap = None, 0.0
    for s, e, who in turns:
        overlap = min(end, e) - max(start, s)
        if overlap > best_overlap:
            best, best_overlap = who, overlap
    return best


def cmd_transcribe(args):
    import ctranslate2
    from faster_whisper import WhisperModel

    gpu = ctranslate2.get_cuda_device_count() > 0 and args.device != "cpu"
    progress(1)
    # A local directory path means no network access at all.
    model = WhisperModel(args.model_dir, device="cuda" if gpu else "cpu", compute_type="float16" if gpu else "int8", local_files_only=True)
    language = None if args.language in ("", "auto") else args.language
    # Pass samples, not the path: AutoKlipper already produced 16 kHz mono audio with FFmpeg,
    # which avoids faster-whisper's own decoder and its version-sensitive PyAV dependency.
    samples, rate = read_wav(args.audio)
    if rate != 16000:
        raise RuntimeError("Expected 16 kHz audio.")
    segments, info = model.transcribe(samples, language=language, word_timestamps=True, vad_filter=True, beam_size=5)
    total = info.duration or 1.0
    out = []
    for seg in segments:
        words = [
            {"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip(), "prob": round(w.probability, 3)}
            for w in (seg.words or [])
            if w.word.strip()
        ]
        if words:
            out.append({"start": words[0]["start"], "end": words[-1]["end"], "text": seg.text.strip(), "words": words})
        progress(seg.end / total * (85 if args.speaker_dir else 99))

    warning = None
    speaker_count = 0
    if args.speaker_dir and out:
        try:
            turns = speakers_for(args.audio, args.speaker_dir)
            for seg in out:
                seg["speaker"] = assign_speaker(seg["start"], seg["end"], turns)
            speaker_count = len({t[2] for t in turns})
        except Exception as e:  # speakers are a bonus; a transcript without them is still useful
            warning = f"Speaker detection failed: {e}"

    result = {
        "language": info.language,
        "duration": round(info.duration, 2),
        "segments": out,
        "speakerCount": speaker_count,
        "warning": warning,
        "device": "cuda" if gpu else "cpu",
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)


def cmd_serve(args):
    """Keep the model loaded for live monitoring. Reads one WAV path per line on stdin and
    answers each with a `CLIPIT_RESULT <json>` line."""
    import ctranslate2
    from faster_whisper import WhisperModel

    gpu = ctranslate2.get_cuda_device_count() > 0 and args.device != "cpu"
    model = WhisperModel(args.model_dir, device="cuda" if gpu else "cpu", compute_type="float16" if gpu else "int8", local_files_only=True)
    language = None if args.language in ("", "auto") else args.language
    print("CLIPIT_READY", flush=True)
    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            samples, rate = read_wav(path)
            if rate != 16000:
                raise RuntimeError("Expected 16 kHz audio.")
            segments, info = model.transcribe(samples, language=language, word_timestamps=True, vad_filter=True, beam_size=1)
            out = []
            for seg in segments:
                words = [{"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()} for w in (seg.words or []) if w.word.strip()]
                if words:
                    out.append({"words": words})
            # Remember the language once heard, so short segments are not re-guessed.
            if language is None and out and info.language_probability > 0.8:
                language = info.language
            result = {"segments": out, "language": info.language}
        except Exception as e:
            result = {"error": f"{type(e).__name__}: {e}"}
        print("CLIPIT_RESULT " + json.dumps(result), flush=True)


def main():
    p = argparse.ArgumentParser(prog="clipit_ai")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check").set_defaults(run=cmd_check)
    d = sub.add_parser("download-model")
    d.add_argument("--model", required=True)
    d.add_argument("--out", required=True)
    d.set_defaults(run=cmd_download_model)
    s = sub.add_parser("download-speaker")
    s.add_argument("--out", required=True)
    s.set_defaults(run=cmd_download_speaker)
    t = sub.add_parser("transcribe")
    t.add_argument("--audio", required=True)
    t.add_argument("--model-dir", required=True)
    t.add_argument("--language", default="auto")
    t.add_argument("--out", required=True)
    t.add_argument("--speaker-dir", default="")
    t.add_argument("--device", default="auto")
    t.set_defaults(run=cmd_transcribe)
    v = sub.add_parser("serve")
    v.add_argument("--model-dir", required=True)
    v.add_argument("--language", default="auto")
    v.add_argument("--device", default="auto")
    v.set_defaults(run=cmd_serve)
    f = sub.add_parser("download-face")
    f.add_argument("--out", required=True)
    f.set_defaults(run=cmd_download_face)
    k = sub.add_parser("track")
    k.add_argument("--video", required=True)
    k.add_argument("--model", required=True)
    k.add_argument("--start", type=float, required=True)
    k.add_argument("--end", type=float, required=True)
    k.add_argument("--fps", type=float, default=5.0)
    k.add_argument("--out", required=True)
    k.set_defaults(run=cmd_track)
    args = p.parse_args()
    try:
        args.run(args)
    except SystemExit:
        raise
    except BaseException as e:  # report one readable line to the app
        print(f"CLIPIT_ERROR: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
