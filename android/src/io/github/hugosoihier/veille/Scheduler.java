package io.github.hugosoihier.veille;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

import java.util.Calendar;

/** Planifie la vérification des alertes (toutes les 15 min) et le réveil du matin. */
final class Scheduler {
    private static final int JOB_ID = 1;

    static void all(Context c) {
        job(c);
        wake(c);
    }

    static void job(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        Prefs p = new Prefs(c);
        if (!p.notifyOn() && p.token().isEmpty()) { js.cancel(JOB_ID); return; }
        if (js.getPendingJob(JOB_ID) != null) return;
        js.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(c, AlertJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60 * 1000L)
                .setPersisted(true)
                .build());
    }

    static void runJobNow(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        js.schedule(new JobInfo.Builder(JOB_ID + 1, new ComponentName(c, AlertJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setOverrideDeadline(1000)
                .build());
    }

    static void wake(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, 0, new Intent(c, WakeReceiver.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Prefs p = new Prefs(c);
        if (!p.nightEnabled()) { am.cancel(pi); return; }
        long at = p.nextWake(Calendar.getInstance());
        try {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (SecurityException e) {      // alarme exacte refusée : réveil à quelques minutes près
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }
}
