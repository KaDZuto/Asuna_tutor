# Maintainer: local user
pkgname=asuna-math-tutor
pkgver=0.2.0
pkgrel=1
pkgdesc='Asuna AI tutor for differential equations and mathematical physics'
arch=('x86_64')
license=('MIT')
depends=('nodejs' 'npm' 'electron' 'poppler')
source=()
sha256sums=()

build() {
  cd "$srcdir/$pkgname"
  npm install --ignore-scripts
}

package() {
  cd "$srcdir/$pkgname"
  install -d "$pkgdir/opt/$pkgname" "$pkgdir/usr/bin" "$pkgdir/usr/share/applications"
  cp -a src package.json package-lock.json node_modules "$pkgdir/opt/$pkgname/"
  cat > "$pkgdir/usr/bin/$pkgname" <<EOF2
#!/usr/bin/env bash
cd /opt/$pkgname
exec electron . "\$@"
EOF2
  chmod +x "$pkgdir/usr/bin/$pkgname"
  install -Dm644 asuna-math-tutor.desktop "$pkgdir/usr/share/applications/asuna-math-tutor.desktop"
}
