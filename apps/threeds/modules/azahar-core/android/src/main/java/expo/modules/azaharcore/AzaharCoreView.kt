package expo.modules.azaharcore

import android.content.Context
import android.graphics.Color
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// TODO: replace with the view Azahar renders both 3DS screens into.
class AzaharCoreView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  init {
    setBackgroundColor(Color.BLACK)
  }
}
