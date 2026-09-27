#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# ── Ollama (локальная Gemma) ──
if command -v ollama >/dev/null 2>&1; then
  if ! curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:11434/api/version | grep -q 200; then
    echo "[run_server] Запускаю 'ollama serve' в фоне..."
    # В bash идиоматично запускать в фоне с логированием в файл (аналог нового окна в Windows)
    ollama serve > ollama-serve.log 2>&1 &
    sleep 3
  else
    echo "[run_server] Ollama уже запущена."
  fi
else
  echo "[run_server] Команда 'ollama' не найдена в PATH — пропускаю автозапуск Ollama."
  echo "[run_server] Установи Ollama: https://ollama.com/download"
fi

# ── Silero TTS сервер ──
if [ ! -d "venv" ]; then
  echo "[run_server] Создаю виртуальное окружение для TTS-сервера..."
  python3 -m venv venv
  source venv/bin/activate
  pip install --upgrade pip
  pip install -r requirements.txt
  pip install python-multipart scipy
  echo "[run_server] Скачиваю локальную модель распознавания речи Whisper (small, ru)..."
  python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8'); print('[run_server] Whisper готов.')"
else
  source venv/bin/activate
  # Добавлено для полного соответствия .bat скрипту
  pip install python-multipart scipy
fi

python tts_server.py

# Аналог команды pause из .bat
read -p "Нажмите Enter для выхода..."