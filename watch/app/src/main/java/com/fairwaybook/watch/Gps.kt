package com.fairwaybook.watch

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import androidx.compose.runtime.mutableStateOf

/** Watch GPS. Uses the watch's own receiver, so the phone can stay in the bag. */
class Gps(context: Context) {
    private val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val fix = mutableStateOf<Location?>(null)
    val error = mutableStateOf<String?>(null)
    private var running = false

    private val listener = LocationListener { loc ->
        // Ignore a worse fix arriving straight after a better one
        val cur = fix.value
        if (cur == null || loc.accuracy <= cur.accuracy + 10 || loc.time - cur.time > 4000) fix.value = loc
        error.value = null
    }

    @SuppressLint("MissingPermission")
    fun start() {
        if (running) return
        try {
            val providers = buildList {
                if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) add(LocationManager.GPS_PROVIDER)
                if (Build.VERSION.SDK_INT >= 31 && lm.allProviders.contains(LocationManager.FUSED_PROVIDER)) add(LocationManager.FUSED_PROVIDER)
                if (isEmpty() && lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) add(LocationManager.NETWORK_PROVIDER)
            }
            if (providers.isEmpty()) {
                error.value = "Location is off. Turn it on in Settings."
                return
            }
            for (p in providers) {
                lm.getLastKnownLocation(p)?.let { if (System.currentTimeMillis() - it.time < 60_000) fix.value = it }
                lm.requestLocationUpdates(p, 1000L, 0f, listener, Looper.getMainLooper())
            }
            running = true
        } catch (e: SecurityException) {
            error.value = "Allow location for Fairway Book"
        }
    }

    fun stop() {
        if (!running) return
        lm.removeUpdates(listener)
        running = false
    }
}
