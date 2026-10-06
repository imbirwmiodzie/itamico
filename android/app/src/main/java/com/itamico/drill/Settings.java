package com.itamico.drill;

import android.content.Context;
import android.content.SharedPreferences;

/** What the user set on the phone screen. Stored in the app's private preferences. */
final class Settings {
    static final String ORDER_EN_IT = "en_it"; // English, pause, Italian: recall
    static final String ORDER_IT_EN = "it_en"; // Italian, pause, English: comprehension
    static final String ORDER_IT = "it";       // Italian, pause: listen and repeat

    static final int DEFAULT_WORDS = 20;
    static final int DEFAULT_PAUSE_SEC = 5;

    /** The same URL as the Claude connector: https://host/mcp/TOKEN. */
    String connectorUrl;
    int words;
    int pauseSec;
    String order;

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("settings", Context.MODE_PRIVATE);
    }

    static Settings load(Context c) {
        SharedPreferences p = prefs(c);
        Settings s = new Settings();
        s.connectorUrl = p.getString("connector_url", "");
        s.words = clamp(p.getInt("words", DEFAULT_WORDS), 1, 100);
        s.pauseSec = clamp(p.getInt("pause_sec", DEFAULT_PAUSE_SEC), 1, 30);
        s.order = p.getString("order", ORDER_EN_IT);
        return s;
    }

    void save(Context c) {
        prefs(c).edit()
                .putString("connector_url", connectorUrl.trim())
                .putInt("words", clamp(words, 1, 100))
                .putInt("pause_sec", clamp(pauseSec, 1, 30))
                .putString("order", order)
                .apply();
    }

    /** https://host, or null when the connector URL isn't of the form …/mcp/TOKEN. */
    String baseUrl() {
        int at = mcpIndex();
        return at < 0 ? null : connectorUrl.trim().substring(0, at);
    }

    String token() {
        int at = mcpIndex();
        if (at < 0) return null;
        String t = connectorUrl.trim().substring(at + "/mcp/".length());
        while (t.endsWith("/")) t = t.substring(0, t.length() - 1);
        return t;
    }

    private int mcpIndex() {
        String u = connectorUrl.trim();
        int at = u.lastIndexOf("/mcp/");
        if (at < 0 || !(u.startsWith("https://") || u.startsWith("http://"))) return -1;
        return u.substring(at + "/mcp/".length()).replace("/", "").isEmpty() ? -1 : at;
    }

    static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }
}
