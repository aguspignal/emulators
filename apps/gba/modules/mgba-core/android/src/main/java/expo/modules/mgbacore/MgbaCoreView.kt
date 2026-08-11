package expo.modules.mgbacore

import android.content.Context
import android.graphics.Color
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// TODO: replace with the SurfaceView/GLSurfaceView mGBA renders into.
class MgbaCoreView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  init {
    setBackgroundColor(Color.BLACK)
  }
}
