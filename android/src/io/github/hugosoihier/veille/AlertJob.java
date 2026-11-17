package io.github.hugosoihier.veille;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Vérifie data.json en arrière-plan et notifie :
 *  - toute alerte CERT-FR de moins de 3 jours ;
 *  - toute faille activement exploitée (CISA KEV) de moins de 7 jours qui touche un logiciel suivi.
 * La liste des logiciels suivis vient de la page Réglages (elle reste sur la tablette).
 */
public class AlertJob extends JobService {
    static final String CHANNEL = "alertes";
    private static final long DAY = 86_400_000L;

    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(new Runnable() {
            public void run() {
                try { check(AlertJob.this); } catch (Exception ignored) { }
                jobFinished(params, false);
            }
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }

    static void check(Context c) throws Exception {
        Prefs p = new Prefs(c);
        if (!p.notifyOn() && p.token().isEmpty()) return;
        String raw;
        try { raw = get(Prefs.DATA_URL); } catch (Exception e) { raw = get(Prefs.DATA_FALLBACK); }
        JSONObject data = new JSONObject(raw);
        maybeTriggerCollect(p, parseDate(data.optString("generated")));
        if (!p.notifyOn()) return;
        JSONArray items = data.getJSONArray("items");
        List<Pattern> watch = compileWatch(p.watchJson());

        Set<String> seen = new LinkedHashSet<>(Arrays.asList(p.seenIds().split(",")));
        boolean primed = p.primed();
        long now = System.currentTimeMillis();
        List<JSONObject> fresh = new ArrayList<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.getJSONObject(i);
            String type = it.optString("type"), id = it.optString("id");
            long age = now - parseDate(it.optString("date"));
            boolean hit = ("alerte".equals(type) && age < 3 * DAY)
                    || ("kev".equals(type) && age < 7 * DAY && matches(it, watch));
            if (hit && !id.isEmpty() && seen.add(id)) fresh.add(it);
        }
        // Premier passage : on mémorise l'existant sans notifier (pas d'avalanche à l'installation).
        if (primed) for (JSONObject it : fresh) notifyItem(c, it, watch);

        List<String> keep = new ArrayList<>(seen);
        keep.remove("");
        if (keep.size() > 400) keep = keep.subList(keep.size() - 400, keep.size());
        p.setSeen(join(keep));
    }

    /* ---------- déclenchement de la collecte GitHub ---------- */

    private static final long STALE_MS = 20 * 60 * 1000L;       // données plus vieilles que 20 min
    private static final long MIN_GAP_MS = 14 * 60 * 1000L;     // au plus un déclenchement par passage
    static final String DISPATCH_URL =
            "https://api.github.com/repos/hugosoihier/veille/actions/workflows/update.yml/dispatches";

    /**
     * GitHub ne garantit pas les tâches planifiées : si les données sont trop vieilles,
     * la tablette lance elle-même le workflow de collecte (jeton limité à « Actions » sur ce dépôt).
     */
    static void maybeTriggerCollect(Prefs p, long generated) {
        String token = p.token();
        long now = System.currentTimeMillis();
        if (token.isEmpty() || now - generated < STALE_MS || now - p.lastTrigger() < MIN_GAP_MS) return;
        p.setTrigger(now, dispatch(token));
    }

    /** Lance le workflow ; renvoie « ok » ou un message d'erreur lisible. */
    static String dispatch(String token) {
        try {
            HttpURLConnection h = (HttpURLConnection) new URL(DISPATCH_URL).openConnection();
            h.setRequestMethod("POST");
            h.setConnectTimeout(15000);
            h.setReadTimeout(20000);
            h.setDoOutput(true);
            h.setRequestProperty("Authorization", "Bearer " + token);
            h.setRequestProperty("Accept", "application/vnd.github+json");
            h.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
            h.setRequestProperty("Content-Type", "application/json");
            h.getOutputStream().write("{\"ref\":\"main\"}".getBytes("UTF-8"));
            int code = h.getResponseCode();
            h.disconnect();
            if (code == 204) return "ok";
            if (code == 401) return "Jeton refusé ou expiré (401)";
            if (code == 403 || code == 404) return "Droits insuffisants : Actions en lecture et écriture sur le dépôt veille (" + code + ")";
            return "Réponse GitHub " + code;
        } catch (Exception e) {
            return "Pas de réponse de GitHub";
        }
    }

    static void ensureChannel(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Alertes de sécurité", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Alertes CERT-FR et failles exploitées touchant les logiciels suivis");
        nm.createNotificationChannel(ch);
    }

    static void notifyItem(Context c, JSONObject it, List<Pattern> watch) {
        boolean kev = "kev".equals(it.optString("type"));
        String head = kev ? "Faille exploitée · logiciel suivi" : "Alerte CERT-FR";
        String title = it.optString("title_fr", "");
        if (title.isEmpty()) title = it.optString("title");
        post(c, it.optString("id").hashCode(), head, title, kev ? "veille.html?type=kev&match=1" : "veille.html?type=alerte");
    }

    static void post(Context c, int id, String head, String text, String page) {
        ensureChannel(c);
        Intent open = new Intent(c, MainActivity.class)
                .putExtra("page", page)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_warning)
                .setContentTitle(head)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setCategory(Notification.CATEGORY_ALARM)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        try {
            ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(id, n);
        } catch (SecurityException ignored) { }  // notifications refusées par l'utilisateur
    }

    /* ---------- outils ---------- */

    static List<Pattern> compileWatch(String json) {
        List<Pattern> out = new ArrayList<>();
        try {
            JSONObject o = new JSONObject(json);
            Iterator<String> groups = o.keys();
            while (groups.hasNext()) {
                JSONArray words = o.optJSONArray(groups.next());
                if (words == null) continue;
                for (int i = 0; i < words.length(); i++) {
                    String w = words.optString(i).trim();
                    if (w.isEmpty()) continue;
                    out.add(Pattern.compile("(?<![\\p{L}\\p{N}_])" + Pattern.quote(w) + "(?![\\p{L}\\p{N}_])",
                            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE));
                }
            }
        } catch (Exception ignored) { }
        return out;
    }

    static boolean matches(JSONObject it, List<Pattern> watch) {
        String text = it.optString("title") + " " + it.optString("summary") + " "
                + it.optString("title_fr") + " " + it.optString("summary_fr");
        for (Pattern p : watch) if (p.matcher(text).find()) return true;
        return false;
    }

    static long parseDate(String iso) {
        try {
            String s = iso.replaceAll("\\.\\d+", "");
            return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.ROOT).parse(s).getTime();
        } catch (Exception e) {
            return 0;
        }
    }

    static String get(String url) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url + "?t=" + System.currentTimeMillis()).openConnection();
        h.setConnectTimeout(15000);
        h.setReadTimeout(30000);
        h.setUseCaches(false);
        try {
            if (h.getResponseCode() != 200) throw new Exception("HTTP " + h.getResponseCode());
            InputStream in = h.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } finally {
            h.disconnect();
        }
    }

    private static String join(List<String> l) {
        StringBuilder b = new StringBuilder();
        for (String s : l) { if (b.length() > 0) b.append(','); b.append(s); }
        return b.toString();
    }
}
