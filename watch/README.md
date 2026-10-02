# Fairway Book for Galaxy Watch

A standalone Wear OS app for Galaxy Watch 4 and newer. It uses the watch's own GPS, so the phone can stay in the bag.

- **Front / centre / back** of the green, in big numbers. Courses without green outlines show front and back marked as estimates (≈).
- **Bezel or crown** changes hole. The on-screen ‹ › buttons do the same.
- **Next hole by GPS**: it picks the hole you're on at the start and moves on when you walk onto the next tee.
- **Tap the big number** to keep your own score. Use + / − or turn the bezel. It shows your running total against par.
- **Long-press the big number** for bunker and water distances (reach / carry).
- Same course data as the phone app. Poult Wood is built in, and **Update courses** downloads any course added later.

The watch score is your own card for the day. The group's official card stays on the scorer's phone.

## Install (one time, about 10 minutes)

Samsung watches only install Play Store apps unless you switch on developer mode, so this is a one-off sideload.

**1. Download the app to your phone**
Open this link on your Android phone and download `FairwayBook-watch.apk`:
https://github.com/kurtrobertson1979-bit/fairway-book/releases/tag/watch-latest

**2. Switch on developer mode on the watch**
- Watch: **Settings → About watch → Software information**, then tap **Software version** 7 times until it says developer mode is on.
- Watch: **Settings → Developer options** → turn on **ADB debugging** and **Wireless debugging** (older watches: **Debug over Wi-Fi**).
- Make sure the watch and phone are on the same Wi-Fi. Wireless debugging shows the watch's **IP address and port**.
- **Turn Bluetooth off on the watch while you install.** Otherwise it keeps using its Bluetooth link to the phone, ignores Wi-Fi, and the install fails. Turn it back on afterwards.
- **Pairing and installing use different port numbers.** Use the IP and port from **Pair new device** (with its six-digit code) to pair, then the IP and port on the main **Wireless debugging** screen to connect and install.

**3. Send the app to the watch from your phone**
- Install **Wear Installer 2** or **Bugjaeger** from the Play Store on your phone.
- In Wear Installer 2: enter the watch's IP address, tap **Pair** if it asks (the watch shows a pairing code under *Wireless debugging → Pair new device*), then choose the downloaded APK and **Install**.
- Accept **Allow debugging** on the watch if it asks.

Fairway Book now appears in the watch's app list. Open it once at home and allow location.

**From a PC instead:** install Android platform-tools, then
```
adb pair <watch-ip>:<pairing-port>
adb connect <watch-ip>:<port>
adb install FairwayBook-watch.apk
```

Turn **Wireless debugging** off again afterwards to save battery.

## Updating

Each new build is published at the same link. Because these are test builds, **uninstall the old one from the watch first** (long-press the icon → Uninstall), then install the new one the same way.

## Battery

GPS plus an always-on screen uses a fair bit of battery. A fully charged Galaxy Watch 5 or newer will manage a round. On a Watch 4, or to be safe, turn **Screen on in round** off in the app's menu and raise your wrist to wake it.

## Building

GitHub builds the app automatically (`.github/workflows/watch.yml`) whenever `watch/` or `data/packs/` changes, then installs it on a Wear OS emulator as a smoke test. To build locally you need JDK 17 and the Android SDK: `gradle -p watch assembleDebug`.
