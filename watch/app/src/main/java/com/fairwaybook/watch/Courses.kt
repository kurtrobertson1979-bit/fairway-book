package com.fairwaybook.watch

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

data class Hazard(val type: String, val poly: List<LatLng>)

data class Hole(
    val n: Int,
    val par: Int,
    val si: Int?,
    val tee: LatLng?,
    val green: LatLng?,
    val greenPoly: List<LatLng>?,
    val hazards: List<Hazard>,
    val yards: Int?,
)

data class Course(val id: String, val name: String, val holes: List<Hole>)

/**
 * Course packs are the same JSON files the phone app ships in /data/packs.
 * Bundled copies live in the APK's assets; "Update courses" downloads any new ones
 * from the website so courses added later reach the watch without a reinstall.
 */
object CourseRepo {
    const val SITE = "https://kurtrobertson1979-bit.github.io/fairway-book/data/packs/"

    private fun ll(a: JSONArray?): LatLng? =
        if (a == null || a.length() < 2) null else LatLng(a.getDouble(0), a.getDouble(1))

    private fun poly(a: JSONArray?): List<LatLng>? {
        if (a == null) return null
        return (0 until a.length()).mapNotNull { ll(a.optJSONArray(it)) }.takeIf { it.size >= 3 }
    }

    fun parse(text: String): Course {
        val o = JSONObject(text)
        val tees = o.optJSONArray("tees") ?: JSONArray()
        // Prefer yellow (the usual men's medal tee), otherwise the first tee with yardages
        var yards: JSONArray? = null
        for (i in 0 until tees.length()) {
            val t = tees.getJSONObject(i)
            val y = t.optJSONArray("yards") ?: continue
            if (yards == null || t.optString("name").equals("Yellow", true)) yards = y
        }
        val hs = o.getJSONArray("holes")
        val holes = (0 until hs.length()).map { i ->
            val h = hs.getJSONObject(i)
            val g = h.optJSONObject("green")
            val hz = h.optJSONArray("hazards") ?: JSONArray()
            Hole(
                n = h.optInt("n", i + 1),
                par = h.optInt("par", 4),
                si = h.optInt("si", 0).takeIf { it > 0 },
                tee = ll(h.optJSONArray("tee")),
                green = ll(g?.optJSONArray("c")),
                greenPoly = poly(g?.optJSONArray("poly")),
                hazards = (0 until hz.length()).mapNotNull { k ->
                    val z = hz.getJSONObject(k)
                    poly(z.optJSONArray("poly"))?.let { Hazard(z.optString("type", "bunker"), it) }
                },
                yards = yards?.optInt(i, 0)?.takeIf { it > 0 },
            )
        }
        return Course(o.getString("id"), o.optString("name", "Course"), holes)
    }

    private fun packDir(ctx: Context) = File(ctx.filesDir, "packs").apply { mkdirs() }

    fun load(ctx: Context): List<Course> {
        val byId = linkedMapOf<String, Course>()
        // Bundled packs
        runCatching {
            val index = JSONObject(ctx.assets.open("index.json").bufferedReader().readText())
            for (key in index.keys()) {
                val file = index.getJSONObject(key).getString("file")
                runCatching { parse(ctx.assets.open(file).bufferedReader().readText()) }
                    .onSuccess { byId[it.id] = it }
            }
        }
        // Downloaded packs override bundled ones
        packDir(ctx).listFiles { f -> f.name.endsWith(".json") }?.sortedBy { it.name }?.forEach { f ->
            runCatching { parse(f.readText()) }.onSuccess { byId[it.id] = it }
        }
        return byId.values.toList()
    }

    private fun get(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 15000
        c.readTimeout = 30000
        c.setRequestProperty("Cache-Control", "no-cache")
        try {
            if (c.responseCode != 200) throw IllegalStateException("HTTP ${c.responseCode}")
            return c.inputStream.bufferedReader().readText()
        } finally {
            c.disconnect()
        }
    }

    /** Downloads every pack listed on the website. Returns how many courses were saved. */
    suspend fun update(ctx: Context): Int = withContext(Dispatchers.IO) {
        val index = JSONObject(get(SITE + "index.json"))
        var n = 0
        for (key in index.keys()) {
            val file = index.getJSONObject(key).getString("file")
            val text = get(SITE + file)
            parse(text) // validate before saving
            File(packDir(ctx), file).writeText(text)
            n++
        }
        n
    }
}
