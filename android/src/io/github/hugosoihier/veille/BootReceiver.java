package io.github.hugosoihier.veille;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.util.Calendar;

/** Au démarrage de la tablette (ou après mise à jour de l'appli) : relance les tâches, ouvre l'appli. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
        Scheduler.all(c);
        Prefs p = new Prefs(c);
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) && p.autostart() && !p.isNight(Calendar.getInstance())) {
            Receivers.openApp(c);
        }
    }
}
