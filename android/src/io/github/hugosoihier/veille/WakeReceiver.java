package io.github.hugosoihier.veille;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;

/** Fin de la plage « nuit » : rallume l'écran et ramène le tableau de bord. */
public class WakeReceiver extends BroadcastReceiver {
    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context c, Intent intent) {
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                | PowerManager.ACQUIRE_CAUSES_WAKEUP, "veille:wake");
        wl.acquire(15000);
        Receivers.openApp(c);
        Scheduler.wake(c);  // réveil suivant
    }
}
