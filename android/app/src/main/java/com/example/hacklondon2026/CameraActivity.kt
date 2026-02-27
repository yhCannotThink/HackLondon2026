package com.example.hacklondon2026

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.view.PreviewView
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
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.presagetech.smartspectra.SmartSpectraSdk
import com.presagetech.smartspectra.SmartSpectraMode
import com.presagetech.smartspectra.utils.MyCameraXPreviewHelper
import com.presagetech.smartspectra.MediapipeGraphViewModel
import com.presage.physiology.proto.MetricsProto.Metrics
import com.example.hacklondon2026.ui.theme.*
import java.util.concurrent.Executors

@ExperimentalCamera2Interop
class CameraActivity : ComponentActivity() {
    
    private lateinit var smartSpectraSdk: SmartSpectraSdk
    private val backgroundExecutor = Executors.newSingleThreadExecutor()
    private val cameraHelper = MyCameraXPreviewHelper()
    private lateinit var mediapipeViewModel: MediapipeGraphViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        if (!hasCameraPermission()) {
            requestCameraPermission()
        }

        // Initialize SDK
        SmartSpectraSdk.initialize(this)
        smartSpectraSdk = SmartSpectraSdk.getInstance()
        smartSpectraSdk.apply {
            setApiKey(BuildConfig.PRESAGE_API_KEY)
            setSmartSpectraMode(SmartSpectraMode.CONTINUOUS)
            setCameraPosition(CameraSelector.LENS_FACING_FRONT)
            setEnableEdgeMetrics(true)
        }

        mediapipeViewModel = MediapipeGraphViewModel.getInstance(this)

        setContent {
            HackLondon2026Theme {
                CameraScreen(
                    sdk = smartSpectraSdk,
                    cameraHelper = cameraHelper,
                    mediapipeViewModel = mediapipeViewModel,
                    backgroundExecutor = backgroundExecutor,
                    onBackClick = { finish() }
                )
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        backgroundExecutor.shutdown()
        cameraHelper.stopCamera()
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

@ExperimentalCamera2Interop
@Composable
fun CameraScreen(
    sdk: SmartSpectraSdk,
    cameraHelper: MyCameraXPreviewHelper,
    mediapipeViewModel: MediapipeGraphViewModel,
    backgroundExecutor: java.util.concurrent.ExecutorService,
    onBackClick: () -> Unit
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    var isFaceDetected by remember { mutableStateOf(false) }

    // Start processing when the screen enters the composition
    LaunchedEffect(Unit) {
        mediapipeViewModel.restart()
        mediapipeViewModel.startRecording()
    }

    DisposableEffect(lifecycleOwner) {
        val observer: (Metrics) -> Unit = { edgeMetrics ->
            isFaceDetected = edgeMetrics.hasFace()
        }
        sdk.setEdgeMetricsObserver(observer)
        onDispose {
            mediapipeViewModel.stopRecording()
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            factory = { context ->
                PreviewView(context).apply {
                    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                    cameraHelper.startCamera(
                        context,
                        lifecycleOwner,
                        this,
                        backgroundExecutor
                    )
                    cameraHelper.onCameraImageProxyListener = MyCameraXPreviewHelper.OnCameraImageProxyListener { imageProxy ->
                        imageProxy.use {
                            mediapipeViewModel.addNewFrame(imageProxy)
                        }
                    }
                }
            },
            modifier = Modifier.fillMaxSize(),
            onRelease = {
                cameraHelper.stopCamera()
            }
        )
        
        // Header with Back Button
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

        // Status Indicator
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
