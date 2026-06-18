package com.koubyte.fitbitaircompanion

import android.os.Bundle
import android.text.InputType
import android.util.Base64
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContract
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.temporal.ChronoUnit

class MainActivity : ComponentActivity() {
    private val permissions = setOf(HealthPermission.getReadPermission(HeartRateRecord::class))
    private lateinit var permissionLauncher: androidx.activity.result.ActivityResultLauncher<Set<String>>
    private var liveJob: Job? = null

    private lateinit var urlInput: EditText
    private lateinit var userInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        permissionLauncher = registerForActivityResult(
            PermissionController.createRequestPermissionResultContract() as ActivityResultContract<Set<String>, Set<String>>
        ) { granted ->
            status("Health Connect permissions: ${granted.size}/${permissions.size}")
        }

        val prefs = getSharedPreferences("settings", MODE_PRIVATE)
        urlInput = field("Dashboard URL", prefs.getString("url", "https://lga9v5vmjp1a00om7lmcstyt.91.99.139.252.sslip.io") ?: "")
        userInput = field("Dashboard user", prefs.getString("user", "") ?: "")
        passwordInput = field("Dashboard password", prefs.getString("password", "") ?: "", password = true)
        statusText = TextView(this).apply {
            text = "Ready"
            textSize = 14f
            setPadding(0, 24, 0, 0)
        }

        setContentView(ScrollView(this).apply {
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(32, 40, 32, 32)
                addView(title("Fitbit Air Companion"))
                addView(urlInput)
                addView(userInput)
                addView(passwordInput)
                addView(button("Grant Health Connect") { requestHealthPermission() })
                addView(button("Sync now") { lifecycleScope.launch { syncHeartRate() } })
                addView(button("Start live sync 15s") { startLiveSync() })
                addView(button("Stop live sync") { stopLiveSync() })
                addView(statusText)
            })
        })
    }

    private fun title(text: String) = TextView(this).apply {
        this.text = text
        textSize = 24f
        setPadding(0, 0, 0, 24)
    }

    private fun field(hint: String, value: String, password: Boolean = false) = EditText(this).apply {
        this.hint = hint
        setText(value)
        inputType = if (password) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_CLASS_TEXT
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    private fun button(text: String, onClick: () -> Unit) = Button(this).apply {
        this.text = text
        setOnClickListener { onClick() }
    }

    private fun saveSettings() {
        getSharedPreferences("settings", MODE_PRIVATE).edit()
            .putString("url", urlInput.text.toString().trim().trimEnd('/'))
            .putString("user", userInput.text.toString())
            .putString("password", passwordInput.text.toString())
            .apply()
    }

    private fun healthClient(): HealthConnectClient? {
        val status = HealthConnectClient.getSdkStatus(this)
        if (status != HealthConnectClient.SDK_AVAILABLE) {
            status("Health Connect unavailable. Install/update Health Connect and enable Fitbit sync.")
            return null
        }
        return HealthConnectClient.getOrCreate(this)
    }

    private fun requestHealthPermission() {
        val client = healthClient() ?: return
        lifecycleScope.launch {
            val granted = client.permissionController.getGrantedPermissions()
            if (granted.containsAll(permissions)) {
                status("Heart rate permission already granted")
            } else {
                permissionLauncher.launch(permissions)
            }
        }
    }

    private fun startLiveSync() {
        if (liveJob?.isActive == true) return
        saveSettings()
        liveJob = lifecycleScope.launch {
            while (isActive) {
                syncHeartRate()
                delay(15_000)
            }
        }
        status("Live sync started")
    }

    private fun stopLiveSync() {
        liveJob?.cancel()
        liveJob = null
        status("Live sync stopped")
    }

    private suspend fun syncHeartRate() {
        saveSettings()
        val client = healthClient() ?: return
        val granted = client.permissionController.getGrantedPermissions()
        if (!granted.containsAll(permissions)) {
            status("Grant Health Connect first")
            return
        }

        val end = Instant.now()
        val start = end.minus(30, ChronoUnit.MINUTES)
        val response = client.readRecords(
            ReadRecordsRequest(
                recordType = HeartRateRecord::class,
                timeRangeFilter = TimeRangeFilter.between(start, end),
            )
        )
        val points = response.records.flatMap { record ->
            record.samples.map { sample ->
                JSONObject()
                    .put("timestamp", sample.time.toString())
                    .put("value", sample.beatsPerMinute)
            }
        }.distinctBy { it.getString("timestamp") }.takeLast(300)

        if (points.isEmpty()) {
            status("No heart rate samples in last 30 minutes")
            return
        }

        val body = JSONObject()
            .put("source", "android-health-connect")
            .put("heart_rate", JSONArray(points))
            .toString()

        val result = postJson("${urlInput.text.toString().trim().trimEnd('/')}/api/mobile-ingest", body)
        status("Uploaded ${points.size} BPM samples. Server: $result")
    }

    private suspend fun postJson(endpoint: String, body: String): String = withContext(Dispatchers.IO) {
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10_000
            readTimeout = 20_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            val basic = "${userInput.text}:${passwordInput.text}".toByteArray(Charsets.UTF_8)
            setRequestProperty("Authorization", "Basic ${Base64.encodeToString(basic, Base64.NO_WRAP)}")
        }

        connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        val text = runCatching {
            (if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()
                ?.use { it.readText() }
        }.getOrNull().orEmpty()
        "${connection.responseCode} ${text.take(160)}"
    }

    private fun status(message: String) {
        runOnUiThread { statusText.text = "${Instant.now()}\n$message" }
    }
}
