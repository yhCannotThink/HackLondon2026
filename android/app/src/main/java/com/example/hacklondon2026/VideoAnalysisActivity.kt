package com.example.hacklondon2026

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.hacklondon2026.ui.theme.HackLondon2026Theme
import com.example.hacklondon2026.ui.theme.MainBlue
import com.example.hacklondon2026.ui.theme.SuccessGreen
import com.presage.physiology.proto.MetricsProto.Metrics
import com.presagetech.smartspectra.MediapipeGraphViewModel
import com.presagetech.smartspectra.SmartSpectraMode
import com.presagetech.smartspectra.SmartSpectraSdk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

class VideoAnalysisActivity : ComponentActivity() {

    private lateinit var smartSpectraSdk: SmartSpectraSdk
    private lateinit var mediapipeViewModel: MediapipeGraphViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val videoUri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra("VIDEO_URI", Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra("VIDEO_URI")
        }

        if (videoUri == null) {
            finish()
            return
        }

        SmartSpectraSdk.initialize(this)
        smartSpectraSdk = SmartSpectraSdk.getInstance()
        smartSpectraSdk.apply {
            setApiKey(BuildConfig.PRESAGE_API_KEY)
            setSmartSpectraMode(SmartSpectraMode.CONTINUOUS)
            setEnableEdgeMetrics(true)
        }
        mediapipeViewModel = MediapipeGraphViewModel.getInstance(this)

        setContent {
            HackLondon2026Theme {
                VideoAnalysisScreen(
                    videoUri = videoUri,
                    sdk = smartSpectraSdk,
                    viewModel = mediapipeViewModel,
                    onBackClick = { finish() }
                )
            }
        }
    }
}

@Composable
fun VideoAnalysisScreen(
    videoUri: Uri,
    sdk: SmartSpectraSdk,
    viewModel: MediapipeGraphViewModel,
    onBackClick: () -> Unit
) {
    val context = LocalContext.current
    var confidenceList by remember { mutableStateOf(listOf<Float>()) }
    var processingProgress by remember { mutableStateOf(0f) }
    var isProcessing by remember { mutableStateOf(true) }

    val averageConfidence = if (confidenceList.isNotEmpty()) confidenceList.average().toFloat() else 0f
    val isRealFace = averageConfidence > 0.7f // Threshold for deepfake classification

    DisposableEffect(Unit) {
        val observer: (Metrics) -> Unit = { edgeMetrics ->
            // Many Presage metrics include confidence scores. 
            // Here we check micro-expressions as a proxy for face-liveness/realness confidence
            if (edgeMetrics.hasFace() && edgeMetrics.face.microExpressionCount > 0) {
                val latestConfidence = edgeMetrics.face.getMicroExpression(0).confidence
                confidenceList = confidenceList + latestConfidence
            } else if (edgeMetrics.hasFace()) {
                // If face detected but no micro-expressions, assign a baseline detection confidence
                confidenceList = confidenceList + 0.5f 
            } else {
                confidenceList = confidenceList + 0.0f
            }
        }
        sdk.setEdgeMetricsObserver(observer)
        onDispose {
            viewModel.stopRecording()
        }
    }

    LaunchedEffect(videoUri) {
        viewModel.restart()
        viewModel.startRecording()

        withContext(Dispatchers.IO) {
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(context, videoUri)
                val durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                val durationMs = durationStr?.toLong() ?: 0L
                
                val stepMs = 500L
                for (timeMs in 0 until durationMs step stepMs) {
                    val bitmap = retriever.getFrameAtTime(timeMs * 1000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                    if (bitmap != null) {
                        withContext(Dispatchers.Main) {
                            viewModel.addNewFrame(bitmap, timeMs)
                            processingProgress = timeMs.toFloat() / durationMs
                        }
                    }
                    delay(50)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                retriever.release()
            }
            
            withContext(Dispatchers.Main) {
                isProcessing = false
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.White)) {
        Column(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            if (isProcessing) {
                CircularProgressIndicator(
                    progress = { processingProgress },
                    color = MainBlue,
                    modifier = Modifier.size(80.dp)
                )
                Spacer(modifier = Modifier.height(24.dp))
                Text("Analyzing Authenticity...", fontSize = 18.sp, fontWeight = FontWeight.Medium)
                Text(
                    "Current confidence: ${(averageConfidence * 100).toInt()}%",
                    fontSize = 14.sp,
                    color = Color.Gray
                )
            } else {
                Icon(
                    imageVector = if (isRealFace) Icons.Default.CheckCircle else Icons.Default.Error,
                    contentDescription = null,
                    tint = if (isRealFace) SuccessGreen else Color.Red,
                    modifier = Modifier.size(80.dp)
                )
                Spacer(modifier = Modifier.height(24.dp))
                Text(
                    text = if (isRealFace) "Video Authenticated" else "Potential Deepfake Detected",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (isRealFace) SuccessGreen else Color.Red
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Average AI Confidence: ${(averageConfidence * 100).toInt()}%",
                    fontSize = 16.sp,
                    color = Color.DarkGray
                )
                
                if (!isRealFace) {
                    Text(
                        text = "Warning: Inconsistencies detected in facial micro-movements.",
                        fontSize = 14.sp,
                        color = Color.Red,
                        modifier = Modifier.padding(top = 16.dp),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center
                    )
                }
            }
        }

        IconButton(
            onClick = onBackClick,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(top = 48.dp, start = 16.dp)
                .clip(CircleShape)
                .background(Color.LightGray.copy(alpha = 0.3f))
        ) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
        }
    }
}
