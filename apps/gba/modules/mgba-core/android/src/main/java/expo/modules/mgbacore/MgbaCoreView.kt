package expo.modules.mgbacore

import android.content.Context
import android.graphics.Color
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Hosts the SurfaceView mGBA blits into. The emulator framebuffer is tiny
 * (240x160 or 160x144); the compositor scales it to the SurfaceView bounds,
 * and this view aspect-fits those bounds inside itself, so the black bars are
 * simply this view's background.
 */
class MgbaCoreView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), SurfaceHolder.Callback {

  private val surfaceView = SurfaceView(context)

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

    val size = MgbaCoreNative.nativeGetVideoSize()
    val videoWidth = if (size[0] > 0) size[0] else 240
    val videoHeight = if (size[1] > 0) size[1] else 160

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

  override fun surfaceCreated(holder: SurfaceHolder) {
    MgbaCoreNative.nativeSurfaceChanged(holder.surface)
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    MgbaCoreNative.nativeSurfaceChanged(holder.surface)
  }

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    // Must not return until the native side can no longer touch this surface.
    MgbaCoreNative.nativeSurfaceDestroyed()
  }

  companion object {
    private val activeViews = CopyOnWriteArraySet<MgbaCoreView>()

    /** Re-runs aspect fitting after a ROM (with possibly new dimensions) loads. */
    fun refreshAllLayouts() {
      for (view in activeViews) {
        view.post(view::requestLayout)
      }
    }
  }
}
