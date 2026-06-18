# Fitbit Air Companion Android

Minimal Android app that reads recent heart-rate samples from Health Connect and posts them to the dashboard.

## Use

1. Open this `android-companion` folder in Android Studio.
2. Let Android Studio install the required SDK/Gradle bits.
3. Run on your Android phone.
4. In Fitbit app, enable Health Connect sync for heart rate.
5. In the companion app, enter:
   - Dashboard URL: `https://lga9v5vmjp1a00om7lmcstyt.91.99.139.252.sslip.io`
   - Dashboard user/password: same Basic Auth as the web dashboard
6. Tap `Grant Health Connect`.
7. Tap `Start live sync 15s`.

This syncs while the app is open. Android background execution is intentionally not implemented yet; add a foreground service only if open-app sync is not enough.
