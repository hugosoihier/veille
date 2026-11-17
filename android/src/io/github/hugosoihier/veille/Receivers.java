package io.github.hugosoihier.veille;

import android.content.Context;
import android.content.Intent;

final class Receivers {
    private Receivers() { }

    /** Ouvre (ou ramène au premier plan) le tableau de bord. */
    static void openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try { c.startActivity(i); } catch (Exception ignored) { }
    }
}
