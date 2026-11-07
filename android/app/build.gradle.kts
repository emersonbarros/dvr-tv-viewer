import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

fun prop(key: String, def: String = "") =
    (localProps.getProperty(key) ?: def).replace("\\", "\\\\").replace("\"", "\\\"")

android {
    namespace = "br.com.reprodutor.intelbras"
    compileSdk = 35

    defaultConfig {
        applicationId = "br.com.reprodutor.intelbras"
        minSdk = 21
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        buildConfigField("String", "DEFAULT_HOST", "\"${prop("camera.host", "192.168.68.150")}\"")
        buildConfigField("String", "DEFAULT_PORT", "\"${prop("camera.port", "554")}\"")
        buildConfigField("String", "DEFAULT_USER", "\"${prop("camera.user")}\"")
        buildConfigField("String", "DEFAULT_PASSWORD", "\"${prop("camera.password")}\"")
    }

    buildFeatures { buildConfig = true }

    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("upload") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Upload key (keystore.properties) for Play; falls back to the debug key for sideloading.
            signingConfig = signingConfigs.findByName("upload") ?: signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    val media3 = "1.4.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-rtsp:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.appcompat:appcompat:1.7.0")
}
