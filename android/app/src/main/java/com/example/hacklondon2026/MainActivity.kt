package com.example.hacklondon2026

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import com.example.hacklondon2026.ui.components.ActionButton
import com.example.hacklondon2026.ui.components.FeatureItem
import com.example.hacklondon2026.ui.components.InfoBox
import com.example.hacklondon2026.ui.theme.*
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            HackLondon2026Theme {
                DeepFakeDetectorScreen(
                    onAnalyzeClick = { uri ->
                        analyzeVideo(uri)
                    }
                )
            }
        }
    }

    private fun analyzeVideo(uri: Uri) {
        lifecycleScope.launch {
            try {
                // Showing a toast for feedback
                Toast.makeText(this@MainActivity, "Analyzing video...", Toast.LENGTH_SHORT).show()
                
                val response = NetworkClient.apiService.analyzeVideo(
                    DetectionRequest(videoUri = uri.toString())
                )
                
                // Handle the response
                val resultText = if (response.isDeepfake) {
                    "Warning: Deepfake detected! (Confidence: ${response.confidence})"
                } else {
                    "Success: Video appears authentic. (Confidence: ${response.confidence})"
                }
                
                Toast.makeText(this@MainActivity, resultText, Toast.LENGTH_LONG).show()
                
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Error: ${e.message}", Toast.LENGTH_LONG).show()
                e.printStackTrace()
            }
        }
    }
}

@Composable
fun DeepFakeDetectorScreen(onAnalyzeClick: (Uri) -> Unit) {
    val context = LocalContext.current
    var selectedVideoUri by remember { mutableStateOf<Uri?>(null) }
    
    val videoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia(),
        onResult = { uri ->
            selectedVideoUri = uri
            if (uri != null) {
                // Launch analysis activity immediately when video is selected
                val intent = Intent(context, VideoAnalysisActivity::class.java).apply {
                    putExtra("VIDEO_URI", uri)
                }
                context.startActivity(intent)
            }
        }
    )

    Scaffold(
        bottomBar = {
            BottomNavigationBar()
        },
        containerColor = ScreenBackground
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
        ) {
            HeaderSection()
            
            Column(
                modifier = Modifier
                    .padding(16.dp)
                    .fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                InfoBox(
                    text = "Upload or record a video to analyze for deepfake manipulation using advanced AI detection."
                )
                
                if (selectedVideoUri != null) {
                    SelectedVideoInfo(selectedVideoUri!!)
                    
                    Button(
                        onClick = { onAnalyzeClick(selectedVideoUri!!) },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = MainBlue),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Analyze Video", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                }
                
                ActionButtons(
                    onRecordClick = {
                        context.startActivity(Intent(context, CameraActivity::class.java))
                    },
                    onUploadClick = {
                        videoPickerLauncher.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly)
                        )
                    }
                )
                
                DetectionFeaturesSection()
            }
        }
    }
}

@Composable
fun SelectedVideoInfo(uri: Uri) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = null,
                tint = SuccessGreen
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column {
                Text(
                    text = "Video Selected",
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp
                )
                Text(
                    text = "Path: ${uri.path?.takeLast(30)}...",
                    fontSize = 12.sp,
                    color = Color.Gray
                )
            }
        }
    }
}

@Composable
fun HeaderSection() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MainBlue)
            .padding(horizontal = 20.dp, vertical = 24.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Outlined.Shield,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.size(32.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = "DeepFake Detector",
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold
            )
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Verify video authenticity with AI",
            color = Color.White.copy(alpha = 0.9f),
            fontSize = 14.sp
        )
    }
}

@Composable
fun ActionButtons(onRecordClick: () -> Unit, onUploadClick: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ActionButton(
            title = "Record Video",
            subtitle = "Capture new video to analyze",
            icon = Icons.Default.Videocam,
            backgroundColor = MainBlue,
            onClick = onRecordClick
        )
        
        ActionButton(
            title = "Upload Video",
            subtitle = "Select from your device",
            icon = Icons.Default.FileUpload,
            backgroundColor = DarkButton,
            onClick = onUploadClick
        )
    }
}

@Composable
fun DetectionFeaturesSection() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Color.White)
            .padding(20.dp)
    ) {
        Text(
            text = "Detection Features",
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            color = Color.Black
        )
        Spacer(modifier = Modifier.height(16.dp))
        
        FeatureItem(
            title = "Facial Analysis",
            description = "Detects inconsistencies in facial features and movements"
        )
        FeatureItem(
            title = "Audio Verification",
            description = "Identifies synthetic voice patterns and audio anomalies"
        )
        FeatureItem(
            title = "Frame Analysis",
            description = "Examines video frames for manipulation artifacts"
        )
        FeatureItem(
            title = "Real-time Processing",
            description = "Fast results powered by AI algorithms"
        )
    }
}

@Composable
fun BottomNavigationBar() {
    NavigationBar(
        containerColor = Color.White,
        tonalElevation = 8.dp
    ) {
        NavigationBarItem(
            icon = { Icon(Icons.Outlined.Shield, contentDescription = "Detect") },
            label = { Text("Detect") },
            selected = true,
            onClick = { },
            colors = NavigationBarItemDefaults.colors(
                selectedIconColor = MainBlue,
                selectedTextColor = MainBlue,
                unselectedIconColor = Color.Gray,
                unselectedTextColor = Color.Gray,
                indicatorColor = Color.Transparent
            )
        )
        NavigationBarItem(
            icon = { Icon(Icons.Outlined.Videocam, contentDescription = "History") },
            label = { Text("History") },
            selected = false,
            onClick = { },
            colors = NavigationBarItemDefaults.colors(
                unselectedIconColor = Color.Gray,
                unselectedTextColor = Color.Gray
            )
        )
        NavigationBarItem(
            icon = { Icon(Icons.Outlined.Info, contentDescription = "About") },
            label = { Text("About") },
            selected = false,
            onClick = { },
            colors = NavigationBarItemDefaults.colors(
                unselectedIconColor = Color.Gray,
                unselectedTextColor = Color.Gray
            )
        )
    }
}

@Preview(showBackground = true)
@Composable
fun DefaultPreview() {
    HackLondon2026Theme {
        DeepFakeDetectorScreen(onAnalyzeClick = {})
    }
}
