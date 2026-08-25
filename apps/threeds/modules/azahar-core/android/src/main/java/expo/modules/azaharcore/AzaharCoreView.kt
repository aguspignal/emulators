package expo.modules.azaharcore

import android.content.Context
import android.graphics.Color
import android.view.Choreographer
import android.view.SurfaceHolder
import android.view.SurfaceView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Hosts the SurfaceView Azahar renders into over EGL. The engine's custom
 * layout composites both 3DS screens into one frame — stacked 400x480 with the
 * narrower bottom screen centred, or side-by-side 720x240 when `screenLayout`
 * says "horizontal". setFixedSize pins the surface to exactly those pixels so
 * the layout rects map 1:1 and the compositor scales; this view aspect-fits
 * the SurfaceView bounds, so the black bars are simply its background.
 *
 * Presentation is decoupled from emulation (upstream's model): a Choreographer
 * callback drives nativeTryPresent() every display frame while the surface
 * lives, draining the renderer's frame mailbox on the UI thread.
 *
 * Video only. Touch input is routed by the shared UI, which maps a touch into
 * bottom-screen pixels using the same aspect fit and screen arrangement as
 * onLayout below.
 */
class AzaharCoreView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), SurfaceHolder.Callback, Choreographer.FrameCallback {

  private val surfaceView = SurfaceView(context)
  private var sideBySide = false
  private var presenting = false

  init {
    setBackgroundColor(Color.BLACK)
    surfaceView.holder.addCallback(this)
    surfaceView.holder.setFixedSize(STACKED_WIDTH, STACKED_HEIGHT)
    addView(surfaceView)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    activeViews.add(this)
  }

  override fun onDetachedFromWindow() {
    activeViews.remove(this)
    stopPresenting()
    super.onDetachedFromWindow()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    if (width == 0 || height == 0) return

    val size = AzaharCoreNative.nativeGetVideoSize()
    val videoWidth = if (size[0] > 0) size[0] else if (sideBySide) SIDE_WIDTH else STACKED_WIDTH
    val videoHeight = if (size[1] > 0) size[1] else if (sideBySide) SIDE_HEIGHT else STACKED_HEIGHT

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
    // Rects first: the setFixedSize surface change is what applies them.
    AzaharCoreNative.nativeSetScreenLayout(horizontal)
    if (horizontal) {
      surfaceView.holder.setFixedSize(SIDE_WIDTH, SIDE_HEIGHT)
    } else {
      surfaceView.holder.setFixedSize(STACKED_WIDTH, STACKED_HEIGHT)
    }
    requestLayout()
  }

  override fun surfaceCreated(holder: SurfaceHolder) {
    AzaharCoreNative.nativeSurfaceChanged(holder.surface)
    startPresenting()
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    AzaharCoreNative.nativeSurfaceChanged(holder.surface)
    startPresenting()
  }

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    stopPresenting()
    // Must not return until the native side can no longer touch this surface.
    AzaharCoreNative.nativeSurfaceDestroyed()
  }

  private fun startPresenting() {
    if (!presenting) {
      presenting = true
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  private fun stopPresenting() {
    if (presenting) {
      presenting = false
      Choreographer.getInstance().removeFrameCallback(this)
    }
  }

  override fun doFrame(frameTimeNanos: Long) {
    if (!presenting) return
    AzaharCoreNative.nativeTryPresent()
    Choreographer.getInstance().postFrameCallback(this)
  }

  companion object {
    private const val STACKED_WIDTH = 400
    private const val STACKED_HEIGHT = 480
    private const val SIDE_WIDTH = 720
    private const val SIDE_HEIGHT = 240

    private val activeViews = CopyOnWriteArraySet<AzaharCoreView>()

    /** Re-runs aspect fitting once a ROM has loaded and reported its size. */
    fun refreshAllLayouts() {
      for (view in activeViews) {
        view.post(view::requestLayout)
      }
    }
  }
}
