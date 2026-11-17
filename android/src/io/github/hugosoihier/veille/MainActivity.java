package io.github.hugosoihier.veille;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.Calendar;

/**
 * Coquille Android du tableau de bord « Veille » : affiche le site GitHub Pages en plein écran.
 * Ajoute ce qu'un navigateur ne sait pas faire : démarrage automatique, mode kiosque,
 * mode nuit (écran éteint la nuit / le week-end, rallumé le matin) et notifications d'alerte.
 * Ces options se règlent depuis la page Réglages du site (objet JavaScript « VeilleApp »).
 */
public class MainActivity extends Activity {

    private static final long WAKE_ON_TOUCH_MS = 10 * 60 * 1000L;

    private WebView web;
    private TextView nightOverlay;
    private Prefs prefs;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private volatile boolean offline = false;
    private long awakeUntil = 0;     // réveil manuel pendant la nuit
    private Boolean lastNight = null;

    private final Runnable retry = new Runnable() { public void run() { if (offline) reloadHome(); } };
    private final Runnable minuteTick = new Runnable() {
        public void run() { applyNight(); handler.postDelayed(this, 30_000); }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = new Prefs(this);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#eaf2ff"));
        root.addView(web);

        nightOverlay = new TextView(this);
        nightOverlay.setBackgroundColor(Color.BLACK);
        nightOverlay.setTextColor(Color.parseColor("#33445f"));
        nightOverlay.setTextSize(18);
        nightOverlay.setGravity(Gravity.CENTER);
        nightOverlay.setText("Mode nuit · toucher l'écran pour afficher le tableau de bord");
        nightOverlay.setVisibility(View.GONE);
        nightOverlay.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { awakeUntil = System.currentTimeMillis() + WAKE_ON_TOUCH_MS; applyNight(); }
        });
        root.addView(nightOverlay);
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage (réglages, logiciels suivis)
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " VeilleApp/" + version());
        web.addJavascriptInterface(new Bridge(), "VeilleApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (Prefs.HOST.equalsIgnoreCase(u.getHost())) return false; // pages de l'appli
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;   // liens externes (avis CERT-FR…) : navigateur
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline();
            }
        });
        web.setWebChromeClient(new WebChromeClient());

        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                handler.post(new Runnable() { public void run() { if (offline) reloadHome(); } });
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl(urlFor(getIntent()));

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        AlertJob.ensureChannel(this);
        Scheduler.all(this);
        hideSystemBars();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.hasExtra("page")) web.loadUrl(urlFor(intent));
        awakeUntil = System.currentTimeMillis() + WAKE_ON_TOUCH_MS;  // ouvert depuis une notification
        applyNight();
    }

    private static String urlFor(Intent i) {
        String page = i == null ? null : i.getStringExtra("page");
        if (page == null || !page.matches("[a-z]+\\.html(\\?[\\w=&]*)?")) return Prefs.HOME;
        return "https://" + Prefs.HOST + "/veille/" + page;
    }

    private String version() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (Exception e) { return "?"; }
    }

    /* ---------- hors connexion ---------- */

    private void reloadHome() {
        offline = false;
        handler.removeCallbacks(retry);
        web.loadUrl(Prefs.HOME);
    }

    /** Page affichée quand le site est injoignable ; nouvelle tentative toutes les 15 s. */
    private void showOffline() {
        offline = true;
        String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
                + "<body style='margin:0;height:100vh;display:flex;align-items:center;justify-content:center;"
                + "background:#eaf2ff;font-family:sans-serif;color:#1d2b45;text-align:center'><div>"
                + "<div style='font-size:64px'>&#128225;</div>"
                + "<h1 style='font-size:28px;margin:12px 0'>Pas de connexion Internet</h1>"
                + "<p style='font-size:18px;opacity:.8'>Le tableau de bord se rechargera automatiquement<br>"
                + "d&egrave;s que la tablette sera connect&eacute;e (Wi-Fi ou donn&eacute;es mobiles).</p>"
                + "</div></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, 15000);
    }

    /* ---------- mode nuit ---------- */

    private void applyNight() {
        boolean night = prefs.isNight(Calendar.getInstance()) && System.currentTimeMillis() > awakeUntil;
        if (lastNight != null && lastNight == night) return;
        lastNight = night;
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        if (night) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // l'écran s'éteint selon le délai Android
            lp.screenBrightness = 0.01f;
            nightOverlay.setVisibility(View.VISIBLE);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
            nightOverlay.setVisibility(View.GONE);
            web.evaluateJavascript("window.dispatchEvent(new Event('veilleapp:wake'))", null);
        }
        getWindow().setAttributes(lp);
    }

    /* ---------- mode kiosque (épinglage de l'écran) ---------- */

    private boolean pinned() {
        ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
        return am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }

    private void applyKiosk() {
        try {
            if (prefs.kiosk() && !pinned()) startLockTask();
            else if (!prefs.kiosk() && pinned()) stopLockTask();
        } catch (Exception ignored) { }
    }

    /* ---------- passerelle avec la page Réglages ---------- */

    private final class Bridge {
        @JavascriptInterface
        public String getConfig() {
            JSONObject o = prefs.toJson(version());
            try { o.put("pinned", pinned()); } catch (Exception ignored) { }
            return o.toString();
        }

        @JavascriptInterface
        public void setConfig(String json) {
            try { prefs.fromJson(new JSONObject(json)); } catch (Exception e) { return; }
            handler.post(new Runnable() {
                public void run() {
                    Scheduler.all(MainActivity.this);
                    lastNight = null;
                    applyNight();
                    applyKiosk();
                }
            });
        }

        /** Liste des logiciels suivis, pour le repérage des alertes en arrière-plan. */
        @JavascriptInterface
        public void setWatch(String json) {
            try { new JSONObject(json); prefs.setWatch(json); } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void testNotification() {
            AlertJob.post(MainActivity.this, 4242, "Test de notification",
                    "Les alertes CERT-FR et failles exploitées sur vos logiciels apparaîtront ainsi.", "index.html");
        }

        @JavascriptInterface
        public void checkNow() { Scheduler.runJobNow(MainActivity.this); }

        /** Jeton GitHub (déclenchement de la collecte). Testé tout de suite ; renvoie « ok » ou l'erreur. */
        @JavascriptInterface
        public String setToken(String token) {
            String t = token == null ? "" : token.trim();
            if (t.isEmpty()) {
                prefs.setToken("");
                Scheduler.all(MainActivity.this);
                return "removed";
            }
            String result = AlertJob.dispatch(t);   // appelé hors du fil principal par la WebView
            if ("ok".equals(result)) {
                prefs.setToken(t);
                prefs.setTrigger(System.currentTimeMillis(), "ok");
                Scheduler.all(MainActivity.this);
            }
            return result;
        }
    }

    /* ---------- cycle de vie ---------- */

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else if (!prefs.kiosk()) super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        lastNight = null;
        handler.removeCallbacks(minuteTick);
        handler.post(minuteTick);
        applyKiosk();
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(minuteTick);
        web.onPause();
        super.onPause();
    }
}
