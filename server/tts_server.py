"""
Asuna VectorHeart — локальный TTS + STT сервер.

Голос по умолчанию: baya (русский, женский), синтез — Silero TTS.
Распознавание голоса (STT) — локальный Whisper (faster-whisper, CPU-friendly).
Раньше распознаванием занималась сама LLM (мультимодальный Gemini понимает
аудио напрямую) — но это работает ТОЛЬКО с Gemini. Если ты используешь любой
другой провайдер (Ollama, LM Studio, OpenAI, Anthropic — вообще всё, что не
Gemini), голос нужно сперва превратить в текст локально — для этого здесь
теперь есть Whisper: браузер шлёт запись сюда на /stt, сервер возвращает
текст, и дальше этот текст уходит в LLM обычным текстовым сообщением —
то есть голосовой ввод начинает работать с ЛЮБЫМ провайдером.

Запуск:
    pip install -r requirements.txt
    python tts_server.py
    (или через переменные окружения — см. ниже)

Переменные окружения:
    TTS_HOST             хост сервера (по умолчанию 127.0.0.1)
    TTS_PORT              порт сервера (по умолчанию 8009)
    SILERO_SPEAKER        голос диктора (по умолчанию baya)
    SILERO_MODEL_ID       идентификатор модели для torch.hub, если модель качается сама
                           (по умолчанию v4_ru — актуальная многоголосая ru-модель Silero;
                           если у тебя уже есть локальный файл модели v5, укажи путь через
                           SILERO_MODEL_PATH и это поле игнорируется)
    SILERO_MODEL_PATH     путь к локальному .pt файлу модели Silero (если он у тебя уже
                           скачан отдельно — например файл "v5" модели). Если задан — модель
                           грузится из файла напрямую, torch.hub не используется.
    SILERO_SAMPLE_RATE    частота дискретизации (по умолчанию 48000)
    SILERO_DEVICE         cpu | cuda (по умолчанию cpu)
    WHISPER_MODEL          размер модели Whisper: tiny | base | small | medium | large-v3
                           (по умолчанию small — хороший баланс качества/скорости на CPU
                           для русского языка; скачивается один раз при первом /stt запросе)
    WHISPER_DEVICE         cpu | cuda (по умолчанию cpu)
    WHISPER_COMPUTE_TYPE   int8 | float16 | float32 (по умолчанию int8 — быстрее всего на CPU)
    WHISPER_LANGUAGE       язык распознавания (по умолчанию ru, пусто = автоопределение)
"""

import io
import os
import re
import sys
import threading
import wave

import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

# На Windows консоль (и пайп, через который Electron читает вывод процесса) по умолчанию
# использует codepage вроде cp1252, который не умеет кириллицу — любой print() с русским
# текстом валит процесс с UnicodeEncodeError. Принудительно переключаем stdout/stderr на
# UTF-8, чтобы сервер не падал независимо от того, как и откуда он запущен.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# ────────────────────────── конфигурация ──────────────────────────

HOST = os.environ.get("TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("TTS_PORT", "8009"))
SPEAKER_DEFAULT = os.environ.get("SILERO_SPEAKER", "baya")
MODEL_ID = os.environ.get("SILERO_MODEL_ID", "v5_ru")
MODEL_PATH = os.environ.get("SILERO_MODEL_PATH", "").strip()
SAMPLE_RATE = int(os.environ.get("SILERO_SAMPLE_RATE", "48000"))
DEVICE = os.environ.get("SILERO_DEVICE", "cpu")

VALID_SAMPLE_RATES = (8000, 24000, 48000)
if SAMPLE_RATE not in VALID_SAMPLE_RATES:
    SAMPLE_RATE = 48000

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "ru").strip()

_whisper_model = None
_whisper_lock = threading.Lock()  # инференс Whisper тоже не потокобезопасен — сериализуем

_model = None
_model_lock = threading.Lock()  # синтез не потокобезопасен — сериализуем запросы
_device = torch.device(DEVICE if (DEVICE == "cpu" or torch.cuda.is_available()) else "cpu")


def load_model():
    """Загружает модель Silero TTS: либо из локального файла (MODEL_PATH),
    либо через torch.hub (MODEL_ID) — так проект переживёт любую будущую
    версию модели (в т.ч. "v5"), если у тебя уже есть её .pt файл."""
    global _model
    torch.set_num_threads(max(1, os.cpu_count() or 1))

    if MODEL_PATH:
        if not os.path.isfile(MODEL_PATH):
            raise RuntimeError(f"SILERO_MODEL_PATH указан, но файл не найден: {MODEL_PATH}")
        model = torch.package.PackageImporter(MODEL_PATH).load_pickle("tts_models", "model")
    else:
        # Для Silero v4: model="silero_tts", speaker="v4_ru" (или v3_ru)
        # В torch.hub для ru-моделей параметр 'speaker' часто используется для выбора версии модели.
        model, _ = torch.hub.load(
            repo_or_dir="snakers4/silero-models",
            model="silero_tts",
            language="ru",
            speaker=MODEL_ID,
        )

    model.to(_device)
    _model = model
    return model


def get_model():
    if _model is None:
        with _model_lock:
            if _model is None:
                load_model()
    return _model


def list_speakers():
    model = get_model()
    speakers = getattr(model, "speakers", None)
    if speakers:
        return list(speakers)
    return [SPEAKER_DEFAULT]


_SSML_ESCAPE = str.maketrans({"&": "&amp;", "<": "&lt;", ">": "&gt;"})


def synthesize(text: str, speaker: str, sample_rate: int, put_accent: bool, put_yo: bool) -> np.ndarray:
    text = (text or "").strip()
    if not text:
        raise ValueError("Пустой текст для синтеза")
    # Silero капризен к длине одного куска — режем на предложения и склеиваем,
    # это и есть "нормальный проброс отрезков аудио": длинные ответы Асуны
    # не обрежутся и не упадут с ошибкой.
    chunks = re.split(r"(?<=[.!?…])\s+", text)
    chunks = [c.strip() for c in chunks if c.strip()] or [text]

    model = get_model()
    pieces = []
    with _model_lock:
        for chunk in chunks:
            safe = chunk[:900]  # предохранитель от предельной длины модели
            audio = model.apply_tts(
                text=safe,
                speaker=speaker,
                sample_rate=sample_rate,
                put_accent=put_accent,
                put_yo=put_yo,
            )
            pieces.append(audio.numpy() if hasattr(audio, "numpy") else np.asarray(audio))
            # короткая тишина между предложениями — естественнее звучит проброс кусков
            pieces.append(np.zeros(int(sample_rate * 0.12), dtype=pieces[-1].dtype))
    return np.concatenate(pieces) if pieces else np.zeros(1, dtype=np.float32)


def to_wav_bytes(samples: np.ndarray, sample_rate: int) -> bytes:
    pcm16 = np.clip(samples, -1.0, 1.0)
    pcm16 = (pcm16 * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16.tobytes())
    buf.seek(0)
    return buf.read()


# ────────────────────────── STT (Whisper) ──────────────────────────
# Импортируем faster-whisper лениво: если человек вообще не пользуется голосовым
# вводом, незачем тянуть эту зависимость и её вес в память при обычном запуске.

def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        with _whisper_lock:
            if _whisper_model is None:
                from faster_whisper import WhisperModel
                _whisper_model = WhisperModel(
                    WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE
                )
    return _whisper_model


def transcribe(audio_bytes: bytes, language: str | None) -> str:
    """audio_bytes — сырые байты любого контейнера, который умеет декодировать
    PyAV (webm/opus из браузера — стандартный случай). faster-whisper декодирует
    их сам, отдельный ffmpeg не нужен."""
    if not audio_bytes:
        return ""
    model = get_whisper_model()
    with _whisper_lock:
        segments, _info = model.transcribe(
            io.BytesIO(audio_bytes),
            language=(language or None),
            vad_filter=True,  # обрезаем тишину/шум по краям — короткие голосовые от этого только выигрывают
        )
        return "".join(seg.text for seg in segments).strip()


# ────────────────────────── FastAPI ──────────────────────────

app = FastAPI(title="Asuna VectorHeart — Silero TTS server")


class TtsRequest(BaseModel):
    text: str
    speaker: str | None = None
    sample_rate: int | None = None
    put_accent: bool = True
    put_yo: bool = True


@app.get("/health")
def health():
    try:
        get_model()
        return {"ok": True, "device": str(_device), "speaker_default": SPEAKER_DEFAULT}
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/voices")
def voices():
    try:
        return {"speakers": list_speakers(), "default": SPEAKER_DEFAULT}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tts")
def tts(req: TtsRequest):
    speaker = req.speaker or SPEAKER_DEFAULT
    sr = req.sample_rate or SAMPLE_RATE
    if sr not in VALID_SAMPLE_RATES:
        sr = SAMPLE_RATE
    try:
        samples = synthesize(req.text, speaker, sr, req.put_accent, req.put_yo)
        wav_bytes = to_wav_bytes(samples, sr)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))
    return StreamingResponse(io.BytesIO(wav_bytes), media_type="audio/wav")


@app.post("/stt")
async def stt(audio: UploadFile = File(...), language: str | None = Form(None)):
    # ВАЖНО: параметр называется "audio", а не "file" — ровно то имя поля,
    # с которым браузер шлёт форму (form.append('audio', blob, 'voice.webm')
    # в renderer/control.js). Раньше здесь стояло "file: UploadFile = File(...)",
    # и из-за несовпадения имени поля FastAPI ВСЕГДА отвечал 422 Unprocessable
    # Entity ещё до того, как код вообще пытался распознать звук — голосовой
    # ввод был сломан целиком, вне зависимости от VAD/Whisper/чего угодно ещё.
    try:
        audio_bytes = await audio.read()
        # Язык, присланный клиентом (form.append('language', 'ru')), имеет приоритет
        # над серверной переменной окружения, но если клиент его не прислал —
        # используем WHISPER_LANGUAGE как раньше.
        lang = (language or WHISPER_LANGUAGE or "").strip() or None
        text = transcribe(audio_bytes, lang)
        return {"text": text}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    # Прогреваем модель сразу, чтобы первый запрос из чата не подвисал
    try:
        load_model()
        print(f"[tts_server] Silero модель загружена, голос по умолчанию: {SPEAKER_DEFAULT}, устройство: {_device}")
    except Exception as e:  # noqa: BLE001
        print(f"[tts_server] ВНИМАНИЕ: модель не загрузилась при старте ({e}). "
              f"Попробую снова при первом запросе.")

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
