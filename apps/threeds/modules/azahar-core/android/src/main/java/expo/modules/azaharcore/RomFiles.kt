package expo.modules.azaharcore

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
  /** SHA-1 of the ROM bytes; the library keys everything by it. */
  val sha1: String,
  val size: Long,
  /** Filename stem, used when the ROM header has no title. */
  val fallbackTitle: String,
)

/**
 * Resolves the contract's ROM URI to a real file path, owns the Azahar user
 * tree under filesDir/azahar/, and keeps the sha1 -> title-id map that lets
 * deleteSaveData(sha1) find a title's saves inside the emulated SD card.
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

  /** Root of the core's user tree (config/sdmc/nand/states/...). */
  fun userDir(context: Context): String =
    File(context.filesDir, "azahar").apply { mkdirs() }.absolutePath

  /**
   * Azahar keys battery saves and savestates by the ROM's title id, not its
   * hash — the library only knows hashes, so loadRom records the pairing.
   */
  fun writeTitleIdMap(context: Context, sha1: String, titleId: Long) {
    File(mapDir(context), sha1).writeText(titleId.toString())
  }

  /** Null for a ROM imported before this app ever booted it. */
  fun readTitleIdMap(context: Context, sha1: String): Long? =
    File(mapDir(context), sha1).takeIf { it.isFile }?.readText()?.trim()?.toLongOrNull()

  fun deleteTitleIdMap(context: Context, sha1: String) {
    File(mapDir(context), sha1).delete()
  }

  private fun mapDir(context: Context): File =
    File(context.filesDir, "azahar-map").apply { mkdirs() }

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
      val extension = displayName.substringAfterLast('.', "3ds")
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
}
