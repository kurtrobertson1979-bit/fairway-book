#!/usr/bin/env bash
# Smoke test on a Wear OS emulator: open the app, pick Poult Wood, stand on the
# 1st fairway (fake GPS) and screenshot each screen. Fails on any crash.
set -x
PKG=com.fairwaybook.watch
mkdir -p shots

# wait for the emulator to finish booting and settle
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '')" = "1" ]; do sleep 3; done
sleep 25
adb shell input keyevent KEYCODE_WAKEUP

adb install -r app-debug.apk
adb shell pm grant $PKG android.permission.ACCESS_FINE_LOCATION
adb shell pm grant $PKG android.permission.ACCESS_COARSE_LOCATION
adb logcat -c

fix() { adb emu geo fix 0.2995 51.2265; }  # longitude latitude: middle of Poult Wood's 1st fairway
fix
adb shell am start -n $PKG/.MainActivity
# wait until the course list is on screen
for i in $(seq 1 20); do
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml ui.xml >/dev/null 2>&1
  grep -q "Fairway Book" ui.xml && break
  sleep 3
done
sleep 2
adb exec-out screencap -p > shots/1-courses.png

tap_text() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null
  adb pull /sdcard/ui.xml ui.xml >/dev/null
  local b
  b=$(grep -o "text=\"[^\"]*$1[^\"]*\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" ui.xml | head -1 | grep -o 'bounds="[^"]*"' | grep -o '[0-9]\+' | tr '\n' ' ')
  # shellcheck disable=SC2086
  set -- $b
  [ -n "$4" ] && adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}

tap_text "18 Hole"
for i in 1 2 3 4 5; do fix; sleep 2; done
adb exec-out screencap -p > shots/2-hole.png

SIZE=$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1)
W=${SIZE%x*}; H=${SIZE#*x}
adb shell input tap $(( W / 2 )) $(( H / 2 ))   # tap the big number: score screen
sleep 3
tap_text "+"
sleep 2
adb exec-out screencap -p > shots/3-score.png
tap_text "Done"
sleep 2
adb shell input swipe $(( W / 2 )) $(( H / 2 )) $(( W / 2 )) $(( H / 2 )) 900  # long-press: hazards
sleep 3
adb exec-out screencap -p > shots/4-hazards.png

adb logcat -d > shots/logcat.txt
# only our own crashes count (the emulator's system apps crash on their own)
if grep -A 2 "FATAL EXCEPTION" shots/logcat.txt | grep -q "Process: $PKG"; then
  grep -A 30 "FATAL EXCEPTION" shots/logcat.txt
  exit 1
fi
echo "No crashes"
