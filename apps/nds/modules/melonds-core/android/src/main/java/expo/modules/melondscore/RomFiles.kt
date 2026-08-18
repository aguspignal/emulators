package expo.modules.melondscore

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.security.DigestInputStream
import java.security.MessageDigest

data class ResolvedRom(
  /** Real filesystem path the native core can fopen(). */
  val path: String,
  /** SHA-1 of the ROM bytes; keys battery saves and savestates. */
  val sha1: String,
  val size: Long,
  /** Filename stem, used when the ROM header has no title. */
  val fallbackTitle: String,
)

/**
 * Resolves the contract's ROM URI to a real file path and derives the
 * per-ROM persistence layout under filesDir/melonds/.
 */
object RomFiles {
  fun resolve(context: Context, uri: String): ResolvedRom {
    val parsed = Uri.parse(uri)
    return when (parsed.scheme) {
      null, "", "file" -> fromFile(File(parsed.path ?: uri))
      "content" -> fromContentUri(context, parsed)
      else -> throw IOException("Unsupported ROM URI scheme: ${parsed.scheme}")
    }
  }

  fun savPath(context: Context, sha1: String): String =
    File(dir(context, "saves"), "$sha1.sav").absolutePath

  fun statePath(context: Context, sha1: String, slot: Int): String =
    File(dir(context, "states"), "$sha1.ss$slot").absolutePath

  /** Where Platform::OpenLocalFile resolves relative names. */
  fun localDir(context: Context): String =
    File(context.filesDir, "melonds").apply { mkdirs() }.absolutePath

  /**
   * Removes everything this ROM owns: the battery save and every savestate.
   * Matches states by prefix rather than walking slot numbers, so a stale file
   * from a different slot count can't survive.
   */
  fun deleteSaveData(context: Context, sha1: String) {
    File(dir(context, "saves"), "$sha1.sav").delete()
    dir(context, "states")
      .listFiles { file -> file.name.startsWith("$sha1.ss") }
      ?.forEach { it.delete() }
  }

  private fun fromFile(file: File): ResolvedRom {
    if (!file.isFile) {
      throw IOException("ROM file not found: ${file.absolutePath}")
    }
    val sha1 = FileInputStream(file).use { sha1Of(it) }
    return ResolvedRom(file.absolutePath, sha1, file.length(), file.nameWithoutExtension)
  }

  /**
   * SAF content URIs cannot be fopen()ed natively, so copy into the app cache
   * (hashing in the same pass) and hand the core the copy.
   */
  private fun fromContentUri(context: Context, uri: Uri): ResolvedRom {
    val displayName = queryDisplayName(context, uri) ?: "rom"
    val cacheDir = File(context.cacheDir, "roms").apply { mkdirs() }
    val tempFile = File.createTempFile("rom-", ".tmp", cacheDir)
    try {
      val digest = MessageDigest.getInstance("SHA-1")
      val input = context.contentResolver.openInputStream(uri)
        ?: throw IOException("Cannot open ROM URI: $uri")
      DigestInputStream(input, digest).use { digestIn ->
        tempFile.outputStream().use { out -> digestIn.copyTo(out) }
      }
      val sha1 = digest.digest().joinToString("") { "%02x".format(it) }
      val extension = displayName.substringAfterLast('.', "nds")
      val cached = File(cacheDir, "$sha1.$extension")
      if (!tempFile.renameTo(cached)) {
        throw IOException("Failed to cache ROM copy at ${cached.absolutePath}")
      }
      return ResolvedRom(
        cached.absolutePath,
        sha1,
        cached.length(),
        displayName.substringBeforeLast('.'),
      )
    } finally {
      tempFile.delete()
    }
  }

  private fun queryDisplayName(context: Context, uri: Uri): String? =
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }

  private fun sha1Of(input: InputStream): String {
    val digest = MessageDigest.getInstance("SHA-1")
    val buffer = ByteArray(64 * 1024)
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      digest.update(buffer, 0, read)
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private fun dir(context: Context, name: String): File =
    File(File(context.filesDir, "melonds"), name).apply { mkdirs() }
}
