package io.github.hugosoihier.veille;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Calendar;

/** Réglages propres à l'appli Android (modifiables depuis la page Réglages du site). */
final class Prefs {
    static final String HOST = "hugosoihier.github.io";
    static final String HOME = "https://" + HOST + "/veille/index.html";
    static final String DATA_URL = "https://raw.githubusercontent.com/hugosoihier/veille/data/data.json";
    static final String DATA_FALLBACK = "https://" + HOST + "/veille/data.json";

    private final SharedPreferences sp;

    Prefs(Context c) { sp = c.getSharedPreferences("veille", Context.MODE_PRIVATE); }

    boolean autostart() { return sp.getBoolean("autostart", true); }
    boolean kiosk() { return sp.getBoolean("kiosk", false); }
    boolean notifyOn() { return sp.getBoolean("notify", true); }
    boolean nightEnabled() { return sp.getBoolean("night", false); }
    int nightStart() { return sp.getInt("nightStart", 20 * 60); }   // minutes depuis minuit
    int nightEnd() { return sp.getInt("nightEnd", 7 * 60); }
    boolean weekendOff() { return sp.getBoolean("weekend", true); }
    String watchJson() { return sp.getString("watch", "{}"); }
    String token() { return sp.getString("token", ""); }
    long lastTrigger() { return sp.getLong("trigAt", 0); }
    String triggerStatus() { return sp.getString("trigStatus", ""); }
    void setToken(String t) { sp.edit().putString("token", t == null ? "" : t.trim()).putString("trigStatus", "").apply(); }
    void setTrigger(long at, String status) { sp.edit().putLong("trigAt", at).putString("trigStatus", status).apply(); }
    String seenIds() { return sp.getString("seen", ""); }
    boolean primed() { return sp.getBoolean("primed", false); }

    void setWatch(String json) { sp.edit().putString("watch", json).apply(); }
    void setSeen(String ids) { sp.edit().putString("seen", ids).putBoolean("primed", true).apply(); }
    void setKiosk(boolean on) { sp.edit().putBoolean("kiosk", on).apply(); }

    JSONObject toJson(String version) {
        JSONObject o = new JSONObject();
        try {
            o.put("autostart", autostart());
            o.put("kiosk", kiosk());
            o.put("notify", notifyOn());
            o.put("night", nightEnabled());
            o.put("nightStart", hm(nightStart()));
            o.put("nightEnd", hm(nightEnd()));
            o.put("weekend", weekendOff());
            o.put("version", version);
            o.put("hasToken", !token().isEmpty());          // le jeton lui-même n'est jamais renvoyé à la page
            o.put("trigAt", lastTrigger());
            o.put("trigStatus", triggerStatus());
        } catch (JSONException ignored) { }
        return o;
    }

    void fromJson(JSONObject o) {
        SharedPreferences.Editor e = sp.edit();
        if (o.has("autostart")) e.putBoolean("autostart", o.optBoolean("autostart"));
        if (o.has("kiosk")) e.putBoolean("kiosk", o.optBoolean("kiosk"));
        if (o.has("notify")) e.putBoolean("notify", o.optBoolean("notify"));
        if (o.has("night")) e.putBoolean("night", o.optBoolean("night"));
        if (o.has("weekend")) e.putBoolean("weekend", o.optBoolean("weekend"));
        int s = parseHm(o.optString("nightStart", null)), n = parseHm(o.optString("nightEnd", null));
        if (s >= 0) e.putInt("nightStart", s);
        if (n >= 0) e.putInt("nightEnd", n);
        e.apply();
    }

    static String hm(int m) { return String.format(java.util.Locale.ROOT, "%02d:%02d", m / 60, m % 60); }

    static int parseHm(String s) {
        if (s == null || !s.matches("\\d{1,2}:\\d{2}")) return -1;
        String[] p = s.split(":");
        int h = Integer.parseInt(p[0]), m = Integer.parseInt(p[1]);
        return (h < 24 && m < 60) ? h * 60 + m : -1;
    }

    private boolean offDay(Calendar c) {
        int d = c.get(Calendar.DAY_OF_WEEK);
        return weekendOff() && (d == Calendar.SATURDAY || d == Calendar.SUNDAY);
    }

    /** Vrai pendant la plage « nuit » (ou tout le week-end si l'option est cochée). */
    boolean isNight(Calendar now) {
        if (!nightEnabled()) return false;
        int t = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
        int s = nightStart(), e = nightEnd();
        if (offDay(now)) return true;   // samedi et dimanche entiers (lundi matin : plage normale)
        if (s == e) return false;
        return s < e ? (t >= s && t < e) : (t >= s || t < e);
    }

    /** Prochaine heure de réveil (fin de nuit, jour ouvré). */
    long nextWake(Calendar now) {
        Calendar c = (Calendar) now.clone();
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        c.set(Calendar.HOUR_OF_DAY, nightEnd() / 60);
        c.set(Calendar.MINUTE, nightEnd() % 60);
        for (int i = 0; i < 9; i++) {
            if (c.after(now) && !offDay(c)) return c.getTimeInMillis();
            c.add(Calendar.DAY_OF_MONTH, 1);
        }
        return now.getTimeInMillis() + 24L * 3600 * 1000;
    }
}
