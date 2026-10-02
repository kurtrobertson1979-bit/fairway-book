package com.fairwaybook.watch

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import kotlinx.coroutines.launch
import java.time.LocalDate
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

// Colour-blind-safe: gold and blue, no reds or greens
private val Gold = Color(0xFFFFD24D)
private val Flag = Color(0xFFF5C531)
private val Sky = Color(0xFF7FB8FF)
private val Muted = Color(0xFF9AA6BD)
private val Warn = Color(0xFFF0A640)

class Prefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("fwb", Context.MODE_PRIVATE)
    var yards: Boolean
        get() = p.getBoolean("yards", true)
        set(v) = p.edit().putBoolean("yards", v).apply()
    var autoHole: Boolean
        get() = p.getBoolean("autoHole", true)
        set(v) = p.edit().putBoolean("autoHole", v).apply()
    var keepOn: Boolean
        get() = p.getBoolean("keepOn", true)
        set(v) = p.edit().putBoolean("keepOn", v).apply()

    private fun key(course: String, hole: Int) = "s_${course}_${LocalDate.now()}_$hole"
    fun strokes(course: String, hole: Int) = p.getInt(key(course, hole), 0)
    fun setStrokes(course: String, hole: Int, v: Int) = p.edit().putInt(key(course, hole), v).apply()
    fun lastHole(course: String) = p.getInt("h_${course}_${LocalDate.now()}", 0)
    fun setLastHole(course: String, i: Int) = p.edit().putInt("h_${course}_${LocalDate.now()}", i).apply()
}

class MainActivity : ComponentActivity() {
    private lateinit var gps: Gps

    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { gps.start() }

    private fun hasLocation() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        gps = Gps(this)
        val prefs = Prefs(this)
        if (!hasLocation()) {
            permissions.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        }
        setContent {
            MaterialTheme(colors = Colors(primary = Color(0xFF6AA5FF), onPrimary = Color(0xFF0A1222), secondary = Flag)) {
                FairwayApp(gps, prefs)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (hasLocation()) gps.start()
    }

    override fun onPause() {
        super.onPause()
        gps.stop() // saves battery when the app is not on screen
    }
}

@Composable
fun FairwayApp(gps: Gps, prefs: Prefs) {
    val ctx = LocalContext.current
    var courses by remember { mutableStateOf(CourseRepo.load(ctx)) }
    val nav = rememberSwipeDismissableNavController()
    SwipeDismissableNavHost(navController = nav, startDestination = "courses") {
        composable("courses") {
            CoursesScreen(
                courses = courses,
                prefs = prefs,
                onPick = { nav.navigate("hole/$it") },
                onUpdate = {
                    val msg = try {
                        val n = CourseRepo.update(ctx)
                        "Updated $n course${if (n == 1) "" else "s"}"
                    } catch (e: Exception) {
                        "No connection. Try near your phone or on Wi-Fi."
                    }
                    courses = CourseRepo.load(ctx)
                    msg
                },
            )
        }
        composable("hole/{id}") { entry ->
            val course = courses.find { it.id == entry.arguments?.getString("id") }
            if (course != null) HoleScreen(course, gps, prefs)
        }
    }
}

@Composable
fun CoursesScreen(courses: List<Course>, prefs: Prefs, onPick: (String) -> Unit, onUpdate: suspend () -> String) {
    val listState = rememberScalingLazyListState()
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<String?>(null) }
    var yards by remember { mutableStateOf(prefs.yards) }
    var autoHole by remember { mutableStateOf(prefs.autoHole) }
    var keepOn by remember { mutableStateOf(prefs.keepOn) }
    Scaffold(
        timeText = { TimeText() },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) },
    ) {
        ScalingLazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
            item { ListHeader { Text("Fairway Book", color = Gold) } }
            items(courses) { c ->
                Chip(
                    onClick = { onPick(c.id) },
                    label = { Text(c.name.replace("Golf Course - ", "· "), maxLines = 2, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = { Text("${c.holes.size} holes · par ${c.holes.sumOf { it.par }}") },
                    colors = ChipDefaults.primaryChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Chip(
                    onClick = { scope.launch { status = "Updating…"; status = onUpdate() } },
                    label = { Text("Update courses") },
                    secondaryLabel = { Text(status ?: "Get new courses from the app", maxLines = 2) },
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Chip(
                    onClick = { yards = !yards; prefs.yards = yards },
                    label = { Text("Distances") },
                    secondaryLabel = { Text(if (yards) "Yards" else "Metres") },
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Chip(
                    onClick = { autoHole = !autoHole; prefs.autoHole = autoHole },
                    label = { Text("Next hole by GPS") },
                    secondaryLabel = { Text(if (autoHole) "On: moves on at the next tee" else "Off") },
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Chip(
                    onClick = { keepOn = !keepOn; prefs.keepOn = keepOn },
                    label = { Text("Screen on in round") },
                    secondaryLabel = { Text(if (keepOn) "On (uses more battery)" else "Off: raise wrist to wake") },
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

private fun fmt(m: Double?, yards: Boolean): String =
    if (m == null) "—" else (if (yards) m * Geo.M_TO_YD else m).roundToInt().toString()

@Composable
fun HoleScreen(course: Course, gps: Gps, prefs: Prefs) {
    val ctx = LocalContext.current
    var idx by rememberSaveable { mutableIntStateOf(prefs.lastHole(course.id).coerceIn(0, course.holes.size - 1)) }
    var overlay by remember { mutableIntStateOf(0) } // 0 = yardages, 1 = score, 2 = hazards
    var autoPicked by rememberSaveable { mutableStateOf(false) }
    var scoreVersion by remember { mutableIntStateOf(0) }
    val yards = prefs.yards
    val hole = course.holes[idx]
    val loc = gps.fix.value
    val here = loc?.let { LatLng(it.latitude, it.longitude) }

    fun goTo(i: Int) {
        val n = i.coerceIn(0, course.holes.size - 1)
        if (n != idx) {
            idx = n
            prefs.setLastHole(course.id, n)
        }
    }

    // Keep the screen awake during the round (optional)
    DisposableEffect(prefs.keepOn) {
        val w = (ctx as? Activity)?.window
        if (prefs.keepOn) w?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { w?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }

    // Hole detection: pick the hole you're standing on at the start, then move on at the next tee
    LaunchedEffect(here?.lat, here?.lon) {
        if (here == null || !prefs.autoHole) return@LaunchedEffect
        if (!autoPicked) {
            autoPicked = true
            val nearTee = course.holes.withIndex()
                .filter { it.value.tee != null }
                .minByOrNull { Geo.dist(here, it.value.tee!!) }
            if (nearTee != null && Geo.dist(here, nearTee.value.tee!!) < 60) goTo(nearTee.index)
            return@LaunchedEffect
        }
        val next = course.holes.getOrNull(idx + 1) ?: return@LaunchedEffect
        val nt = next.tee ?: return@LaunchedEffect
        val leftGreen = hole.green?.let { Geo.dist(here, it) > 40 } ?: true
        if (Geo.dist(here, nt) < 30 && leftGreen) goTo(idx + 1)
    }

    val focus = remember { FocusRequester() }
    var spin by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(overlay) { runCatching { focus.requestFocus() } }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onRotaryScrollEvent { e ->
                // Bezel / crown changes hole on the yardage screen, strokes on the score screen
                spin += e.verticalScrollPixels
                if (abs(spin) > 70f) {
                    val dir = if (spin > 0) 1 else -1
                    spin = 0f
                    if (overlay == 1) {
                        val cur = prefs.strokes(course.id, hole.n)
                        val v = if (cur == 0) (if (dir > 0) hole.par else hole.par - 1) else (cur + dir).coerceIn(1, 15)
                        prefs.setStrokes(course.id, hole.n, v)
                        scoreVersion++
                    } else goTo(idx + dir)
                }
                true
            }
            .focusRequester(focus)
            .focusable(),
        contentAlignment = Alignment.Center,
    ) {
        when (overlay) {
            1 -> ScoreView(course, hole, prefs, scoreVersion, onChange = { scoreVersion++ }, onClose = { overlay = 0 })
            2 -> HazardView(hole, here, yards, onClose = { overlay = 0 })
            else -> YardageView(course, hole, idx, here, loc?.accuracy, gps.error.value, yards, prefs, scoreVersion,
                onPrev = { goTo(idx - 1) }, onNext = { goTo(idx + 1) },
                onTap = { overlay = 1 }, onLongPress = { overlay = 2 })
        }
    }
}

@Composable
fun YardageView(
    course: Course, hole: Hole, idx: Int, here: LatLng?, accuracy: Float?, error: String?, yards: Boolean,
    prefs: Prefs, scoreVersion: Int,
    onPrev: () -> Unit, onNext: () -> Unit, onTap: () -> Unit, onLongPress: () -> Unit,
) {
    val centre = if (here != null && hole.green != null) Geo.dist(here, hole.green) else null
    var fb = if (here != null && hole.green != null) Geo.frontBack(here, hole.greenPoly, hole.green) else null
    val estimated = fb == null && centre != null
    if (estimated) fb = Pair(max(0.0, centre!! - 14), centre + 14)
    val pre = if (estimated) "≈" else ""

    // running score for the day
    val played = course.holes.filter { prefs.strokes(course.id, it.n) > 0 }
    val total = played.sumOf { prefs.strokes(course.id, it.n) }
    val vsPar = total - played.sumOf { it.par }
    val thisHole = prefs.strokes(course.id, hole.n)
    @Suppress("UNUSED_EXPRESSION") scoreVersion

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "HOLE ${hole.n} · PAR ${hole.par}" + (hole.si?.let { " · SI $it" } ?: ""),
            fontSize = 13.sp, color = Muted, fontWeight = FontWeight.Bold,
        )
        Text("B ${pre}${fmt(fb?.second, yards)}", fontSize = 20.sp, color = Color.White)
        Box(
            modifier = Modifier.pointerInput(Unit) { detectTapGestures(onTap = { onTap() }, onLongPress = { onLongPress() }) },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                fmt(centre, yards), fontSize = 64.sp, fontWeight = FontWeight.Bold, color = Gold,
                textAlign = TextAlign.Center, modifier = Modifier.width(150.dp),
            )
        }
        Text("F ${pre}${fmt(fb?.first, yards)}", fontSize = 20.sp, color = Color.White)
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            Button(onClick = onPrev, enabled = idx > 0, colors = ButtonDefaults.secondaryButtonColors(), modifier = Modifier.size(ButtonDefaults.ExtraSmallButtonSize)) { Text("‹", fontSize = 18.sp) }
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(76.dp)) {
                val dot = when {
                    error != null -> Warn
                    accuracy == null -> Muted
                    accuracy < 12f -> Sky
                    else -> Warn
                }
                Box(Modifier.size(7.dp).background(dot, CircleShape))
                Text(
                    when {
                        error != null -> error
                        here == null -> "Finding GPS…"
                        thisHole > 0 -> "Took $thisHole"
                        played.isNotEmpty() -> "${if (vsPar > 0) "+" else ""}${if (vsPar == 0) "E" else vsPar.toString()} thru ${played.size}"
                        else -> "Tap to score"
                    },
                    fontSize = 11.sp, color = Muted, textAlign = TextAlign.Center, maxLines = 2,
                )
            }
            Spacer(Modifier.width(8.dp))
            Button(onClick = onNext, enabled = idx < course.holes.size - 1, colors = ButtonDefaults.secondaryButtonColors(), modifier = Modifier.size(ButtonDefaults.ExtraSmallButtonSize)) { Text("›", fontSize = 18.sp) }
        }
    }
}

@Composable
fun ScoreView(course: Course, hole: Hole, prefs: Prefs, scoreVersion: Int, onChange: () -> Unit, onClose: () -> Unit) {
    @Suppress("UNUSED_EXPRESSION") scoreVersion
    val cur = prefs.strokes(course.id, hole.n)
    fun set(v: Int) { prefs.setStrokes(course.id, hole.n, v); onChange() }
    val played = course.holes.filter { prefs.strokes(course.id, it.n) > 0 }
    val total = played.sumOf { prefs.strokes(course.id, it.n) }
    val vsPar = total - played.sumOf { it.par }
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("HOLE ${hole.n} · PAR ${hole.par}", fontSize = 13.sp, color = Muted, fontWeight = FontWeight.Bold)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = { set(if (cur == 0) hole.par - 1 else max(1, cur - 1)) }, colors = ButtonDefaults.secondaryButtonColors(), modifier = Modifier.size(ButtonDefaults.SmallButtonSize)) { Text("−", fontSize = 22.sp) }
            Text(
                if (cur == 0) "–" else cur.toString(), fontSize = 52.sp, fontWeight = FontWeight.Bold,
                color = when {
                    cur == 0 -> Muted
                    cur < hole.par -> Sky
                    else -> Color.White
                },
                textAlign = TextAlign.Center, modifier = Modifier.width(80.dp),
            )
            Button(onClick = { set(if (cur == 0) hole.par else (cur + 1).coerceAtMost(15)) }, colors = ButtonDefaults.secondaryButtonColors(), modifier = Modifier.size(ButtonDefaults.SmallButtonSize)) { Text("+", fontSize = 22.sp) }
        }
        Text(
            if (played.isEmpty()) "Turn the bezel or tap + / −" else "$total total · ${if (vsPar > 0) "+" else ""}${if (vsPar == 0) "E" else vsPar.toString()} thru ${played.size}",
            fontSize = 12.sp, color = Muted, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(6.dp))
        Chip(onClick = onClose, label = { Text("Done") }, colors = ChipDefaults.primaryChipColors(), modifier = Modifier.width(110.dp))
    }
}

@Composable
fun HazardView(hole: Hole, here: LatLng?, yards: Boolean, onClose: () -> Unit) {
    val listState = rememberScalingLazyListState()
    val rows = if (here == null) emptyList() else hole.hazards
        .map { Triple(it.type, Geo.reachCarry(here, it.poly).first, Geo.reachCarry(here, it.poly).second) }
        .filter { it.third > 15 }
        .sortedBy { it.second }
    ScalingLazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
        item { ListHeader { Text("Hole ${hole.n} hazards", color = Flag) } }
        if (rows.isEmpty()) item { Text(if (here == null) "Waiting for GPS" else "Nothing in front of you", color = Muted, fontSize = 13.sp) }
        items(rows) { (type, reach, carry) ->
            Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(if (type == "water") "Water" else "Bunker", color = if (type == "water") Color(0xFF6FB6FF) else Color(0xFFE9D8A6), fontSize = 15.sp)
                Text("${fmt(reach, yards)} / ${fmt(carry, yards)}", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
        }
        item { Text("reach / carry", color = Muted, fontSize = 11.sp) }
        item { Chip(onClick = onClose, label = { Text("Back") }, colors = ChipDefaults.secondaryChipColors()) }
    }
}
