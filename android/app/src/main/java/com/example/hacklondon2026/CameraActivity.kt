package com.example.hacklondon2026

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.camera.core.CameraSelector
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.presagetech.smartspectra.SmartSpectraSdk
import com.presagetech.smartspectra.SmartSpectraView
import com.presagetech.smartspectra.SmartSpectraMode
import com.presage.physiology.proto.MetricsProto.Metrics
import com.example.hacklondon2026.ui.theme.*

class CameraActivity : ComponentActivity() {
    
    private lateinit var smartSpectraSdk: SmartSpectraSdk

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        if (!hasCameraPermission()) {
            requestCameraPermission()
        }

        // Initialize SDK
        smartSpectraSdk = SmartSpectraSdk.getInstance()
        smartSpectraSdk.apply {
            // Using the API key from BuildConfig (populated from local.properties)
            setApiKey(BuildConfig.PRESAGE_API_KEY)
            setSmartSpectraMode(SmartSpectraMode.CONTINUOUS)
            setCameraPosition(CameraSelector.LENS_FACING_FRONT)
        }

        setContent {
            HackLondon2026Theme {
                CameraScreen(
                    sdk = smartSpectraSdk,
                    onBackClick = { finish() }
                )
            }
        }
    }

    private fun hasCameraPermission() = ContextCompat.checkSelfPermission(
        this, Manifest.permission.CAMERA
    ) == PackageManager.PERMISSION_GRANTED

    private fun requestCameraPermission() {
        ActivityCompat.requestPermissions(
            this, arrayOf(Manifest.permission.CAMERA), 0
        )
    }
}

@Composable
fun CameraScreen(
    sdk: SmartSpectraSdk,
    onBackClick: () -> Unit
) {
    var isFaceDetected by remember { mutableStateOf(false) }

    DisposableEffect(Unit) {
        sdk.setEdgeMetricsObserver { edgeMetrics: Metrics ->
            isFaceDetected = edgeMetrics.hasFace()
        }
        onDispose { }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            factory = { context ->
                SmartSpectraView(
                    context,
                    attrs = TODO()
                )
            },
            modifier = Modifier.fillMaxSize()
        )
        
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 48.dp, start = 16.dp, end = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(
                onClick = onBackClick,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.3f))
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = Color.White
                )
            }
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 64.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Surface(
                color = if (isFaceDetected) SuccessGreen.copy(alpha = 0.9f) else Color.Red.copy(alpha = 0.8f),
                shape = CircleShape,
                modifier = Modifier.padding(bottom = 16.dp)
            ) {
                Text(
                    text = if (isFaceDetected) "Face Detected" else "No Face Detected",
                    color = Color.White,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp
                )
            }
            
            Text(
                text = "Position your face in the center of the frame",
                color = Color.White.copy(alpha = 0.7f),
                fontSize = 14.sp
            )
        }
    }
}
