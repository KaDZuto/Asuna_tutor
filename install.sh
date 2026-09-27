#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
APP_DIR="$(pwd)"

command -v pacman >/dev/null || { echo 'Этот установщик рассчитан на Arch Linux.'; exit 1; }
echo '[1/4] Проверяю системные зависимости...'
sudo pacman -S --needed --noconfirm nodejs npm poppler

echo '[2/4] Устанавливаю JS-зависимости...'
# npm >= 11 блокирует postinstall-скрипты, поэтому бинарник electron берём из
# уже установленной Асунны (тот же runtime 44.4.0), если он не скачан.
if [ ! -x node_modules/electron/dist/electron ]; then
  npm install --no-audit --no-fund || true
  if [ ! -x node_modules/electron/dist/electron ]; then
    for c in "$HOME/Downloads/Asuna_Electron_PC-main-node26-fixed-latest/самая новая версия" \
             "$HOME/src/hermes_paperclip_agent" "$HOME/hermes_paperclip_agent"; do
      if [ -x "$c/node_modules/electron/dist/electron" ]; then
        echo "    копирую electron из $c"
        cp -a "$c/node_modules/electron/dist" node_modules/electron/dist
        cp -a "$c/node_modules/electron/path.txt" node_modules/electron/path.txt
        cp -a "$c/node_modules/electron/abi_version" node_modules/electron/abi_version
        break
      fi
    done
  fi
fi
[ -x node_modules/electron/dist/electron ] || { echo 'Не удалось получить electron.'; exit 1; }

echo '[3/4] Ставлю launcher и GNOME desktop entry...'
mkdir -p "$HOME/.local/share/applications" "$HOME/.local/bin"
cat > "$HOME/.local/bin/asuna-math-tutor" <<LAUNCH
#!/usr/bin/env bash
cd "$APP_DIR"
exec ./node_modules/electron/dist/electron "\$@"
LAUNCH
chmod +x "$HOME/.local/bin/asuna-math-tutor"
cp -f asuna-math-tutor.desktop "$HOME/.local/share/applications/asuna-math-tutor.desktop"
update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true

echo '[4/4] Готово.'
echo "Запуск: asuna-math-tutor   (или: $APP_DIR/run.sh)"
echo 'Рядом с Асунной: ./launch-with-asuna.sh'
