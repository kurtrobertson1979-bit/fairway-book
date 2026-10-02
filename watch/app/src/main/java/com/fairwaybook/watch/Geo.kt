package com.fairwaybook.watch

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

data class LatLng(val lat: Double, val lon: Double)

/** Distance maths, ported from the phone app's geo.js so both give the same numbers. */
object Geo {
    private const val R = 6371008.8
    const val M_TO_YD = 1.0936133

    private fun rad(d: Double) = Math.toRadians(d)

    fun dist(a: LatLng, b: LatLng): Double {
        val dLat = rad(b.lat - a.lat)
        val dLon = rad(b.lon - a.lon)
        val s = sin(dLat / 2).let { it * it } + cos(rad(a.lat)) * cos(rad(b.lat)) * sin(dLon / 2).let { it * it }
        return 2 * R * asin(sqrt(s))
    }

    /** Local flat projection in metres around [origin]. */
    private fun project(origin: LatLng, p: LatLng): Pair<Double, Double> {
        val k = cos(rad(origin.lat))
        return Pair(rad(p.lon - origin.lon) * R * k, rad(p.lat - origin.lat) * R)
    }

    private fun pointInPoly(pt: LatLng, poly: List<LatLng>): Boolean {
        var inside = false
        var j = poly.size - 1
        for (i in poly.indices) {
            val yi = poly[i].lat; val xi = poly[i].lon
            val yj = poly[j].lat; val xj = poly[j].lon
            if ((yi > pt.lat) != (yj > pt.lat) && pt.lon < (xj - xi) * (pt.lat - yi) / (yj - yi) + xi) inside = !inside
            j = i
        }
        return inside
    }

    /** Front and back of the green along the line from [from] through the green centre. */
    fun frontBack(from: LatLng, poly: List<LatLng>?, centre: LatLng): Pair<Double, Double>? {
        if (poly == null || poly.size < 3) return null
        val (cx, cy) = project(from, centre)
        val len = hypot(cx, cy)
        if (len < 1) return Pair(0.0, 0.0)
        val ux = cx / len
        val uy = cy / len
        val pts = poly.map { project(from, it) }
        val ts = mutableListOf<Double>()
        for (i in pts.indices) {
            val (ax, ay) = pts[i]
            val (bx, by) = pts[(i + 1) % pts.size]
            val ex = bx - ax
            val ey = by - ay
            val den = ux * ey - uy * ex
            if (kotlin.math.abs(den) < 1e-12) continue
            val t = (ax * ey - ay * ex) / den
            val s = (ax * uy - ay * ux) / den
            if (s in 0.0..1.0 && t >= 0) ts.add(t)
        }
        if (ts.isEmpty()) return null
        val front = if (pointInPoly(from, poly)) 0.0 else ts.min()
        return Pair(front, ts.max())
    }

    /** Nearest and furthest edge of a hazard (reach / carry). */
    fun reachCarry(from: LatLng, poly: List<LatLng>): Pair<Double, Double> {
        var lo = Double.MAX_VALUE
        var hi = 0.0
        for (p in poly) {
            val d = dist(from, p)
            lo = min(lo, d)
            hi = max(hi, d)
        }
        return Pair(lo, hi)
    }

    /** Distance from [p] to the straight line tee -> green. */
    fun distToSegment(p: LatLng, a: LatLng, b: LatLng): Double {
        val (ax, ay) = project(p, a)
        val (bx, by) = project(p, b)
        val dx = bx - ax
        val dy = by - ay
        val l2 = dx * dx + dy * dy
        var t = if (l2 > 0) -(ax * dx + ay * dy) / l2 else 0.0
        t = t.coerceIn(0.0, 1.0)
        return hypot(ax + t * dx, ay + t * dy)
    }
}
