package expo.modules.melondscore

import android.content.Context
import android.graphics.Color
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// TODO: replace with the view melonDS renders both screens into.
class MelondsCoreView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  init {
    setBackgroundColor(Color.BLACK)
  }
}
