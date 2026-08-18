package expo.modules.melondscore

import android.content.Context
import android.graphics.Color
import android.view.SurfaceHolder
import android.view.SurfaceView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Hosts the SurfaceView melonDS blits into. The engine composites both DS
 * screens into one framebuffer — stacked 256x384, or side-by-side 512x192 when
 * the `screenLayout` prop says "horizontal" — so this is a single surface like
 * the GBA app's: the compositor scales it to the SurfaceView bounds, and this
 * view aspect-fits those bounds inside itself, so the black bars are simply
 * this view's background.
 *
 * Video only. Touch input is routed by the shared UI, which maps a touch into
 * bottom-screen pixels using the same aspect fit and screen arrangement as
 * onLayout below.
 */
class MelondsCoreView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), SurfaceHolder.Callback {

  private val surfaceView = SurfaceView(context)
  private var sideBySide = false

  init {
    setBackgroundColor(Color.BLACK)
    surfaceView.holder.addCallback(this)
    addView(surfaceView)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    activeViews.add(this)
  }

  override fun onDetachedFromWindow() {
    activeViews.remove(this)
    super.onDetachedFromWindow()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    if (width == 0 || height == 0) return

    val size = MelondsCoreNative.nativeGetVideoSize()
    // Pre-ROM fallback matches what the engine will report for this layout.
    val videoWidth = if (size[0] > 0) size[0] else if (sideBySide) 512 else 256
    val videoHeight = if (size[1] > 0) size[1] else if (sideBySide) 192 else 384

    // Largest aspect-correct rect that fits, centered.
    val scale = minOf(width.toFloat() / videoWidth, height.toFloat() / videoHeight)
    val childWidth = (videoWidth * scale).toInt()
    val childHeight = (videoHeight * scale).toInt()
    val childLeft = (width - childWidth) / 2
    val childTop = (height - childHeight) / 2

    surfaceView.measure(
      MeasureSpec.makeMeasureSpec(childWidth, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(childHeight, MeasureSpec.EXACTLY),
    )
    surfaceView.layout(childLeft, childTop, childLeft + childWidth, childTop + childHeight)
  }

  /** Re-arranges the composited screens; the shared UI decides per orientation. */
  fun setScreenLayout(horizontal: Boolean) {
    if (sideBySide == horizontal) return
    sideBySide = horizontal
    MelondsCoreNative.nativeSetScreenLayout(horizontal)
    requestLayout()
  }

  override fun surfaceCreated(holder: SurfaceHolder) {
    MelondsCoreNative.nativeSurfaceChanged(holder.surface)
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    MelondsCoreNative.nativeSurfaceChanged(holder.surface)
  }

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    // Must not return until the native side can no longer touch this surface.
    MelondsCoreNative.nativeSurfaceDestroyed()
  }

  companion object {
    private val activeViews = CopyOnWriteArraySet<MelondsCoreView>()

    /** Re-runs aspect fitting once a ROM has loaded and reported its size. */
    fun refreshAllLayouts() {
      for (view in activeViews) {
        view.post(view::requestLayout)
      }
    }
  }
}
