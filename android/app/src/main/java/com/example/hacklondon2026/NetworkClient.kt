package com.example.hacklondon2026

import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Body

// Data model for backend response
data class DetectionResponse(
    val isDeepfake: Boolean,
    val confidence: Double,
    val message: String
)

// Data model for backend request
data class DetectionRequest(
    val videoUri: String,
    val metadata: Map<String, String> = emptyMap()
)

interface ApiService {
    @GET("/")
    suspend fun checkStatus(): Map<String, String>

    @POST("/analyze")
    suspend fun analyzeVideo(@Body request: DetectionRequest): DetectionResponse
}

object NetworkClient {
    private const val BASE_URL = "http://127.0.0.1:3000/"

    private val logging = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BODY
    }

    private val client = OkHttpClient.Builder()
        .addInterceptor(logging)
        .build()

    val apiService: ApiService by lazy {
        Retrofit.Builder()
            .baseUrl(BASE_URL)
            .addConverterFactory(GsonConverterFactory.create())
            .client(client)
            .build()
            .create(ApiService::class.java)
    }
}
