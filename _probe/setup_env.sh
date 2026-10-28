# 沙箱重置后重建测试环境（第 274 次整理）。不提交。用法：bash _probe/setup_env.sh && . /tmp/wk/env.sh
set -e
mkdir -p ~/.fonts /tmp/wk /tmp/apt/lists/partial /tmp/apt/cache/archives/partial
cd /tmp
[ -f ~/.fonts/nsc.otf ] || curl -sL -o ~/.fonts/nsc.otf https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf
[ -f ~/.fonts/nscb.otf ] || curl -sL -o ~/.fonts/nscb.otf https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf
fc-cache -f >/dev/null
python -m playwright install webkit >/dev/null 2>&1 || true
A="-o Dir::State::Lists=/tmp/apt/lists -o Dir::Cache=/tmp/apt/cache -o Debug::NoLocking=1"
cd /tmp/apt; apt-get $A update >/dev/null 2>&1 || true
for l in libgles2 libatk1.0-0t64 libatk-bridge2.0-0t64 libavif16 libenchant-2-2 libepoxy0 libevent-2.1-7t64 libgraphene-1.0-0 libgstreamer-plugins-base1.0-0 libgstreamer1.0-0 libgstreamer-gl1.0-0 libgstreamer-plugins-bad1.0-0 libgtk-4-1 libharfbuzz-icu0 libhyphen0 libmanette-0.2-0 libsecret-1-0 libxslt1.1 libegl1 libglvnd0 libxdamage1 libxinerama1 libatspi2.0-0t64 libbacktrace0 libcairo-script-interpreter2 libcloudproviders0 libevdev2 libgav1-1 libgudev-1.0-0 libharfbuzz-subset0 libhidapi-hidraw0 liborc-0.4-0t64 libsoup-3.0-0 libyuv0 libabsl20240722 libdav1d7 librav1e0.7 libsvtav1enc2 libaom3 libwoff1 libopengl0 libglx0 libglx-mesa0 libegl-mesa0 libgbm1 libgl1-mesa-dri libwayland-server0 libwayland-client0 libdrm2 libdrm-amdgpu1 libxcb-dri3-0 libxcb-present0 libxcb-sync1 libxshmfence1 libxcb-xfixes0 libxcb-randr0 libllvm19 libsensors5 libz3-4 libxml2 libedit2 libelf1t64 libx11-xcb1 libdrm-radeon1 libxcb-dri2-0 libxcb-glx0 libxcb-shm0 liblzo2-2 libxcomposite1; do apt-get $A download $l >/dev/null 2>&1 || echo "FAIL $l"; done
mkdir -p root; for d in *.deb; do dpkg -x $d root; done
R=/tmp/apt/root/usr/lib/aarch64-linux-gnu
W=$(ls -d ~/.cache/ms-playwright/webkit-*)
for m in minibrowser-wpe minibrowser-gtk; do mkdir -p $W/$m/sys/lib; cp -an $R/* $W/$m/sys/lib/ 2>/dev/null || true; done
cat > /tmp/wk/env.sh <<EOT
export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1
export __EGL_VENDOR_LIBRARY_DIRS=/tmp/apt/root/usr/share/glvnd/egl_vendor.d
export LIBGL_DRIVERS_PATH=$R/dri
export GBM_BACKENDS_PATH=$R/gbm
export EGL_PLATFORM=surfaceless
export LD_LIBRARY_PATH=$R
EOT
echo done
