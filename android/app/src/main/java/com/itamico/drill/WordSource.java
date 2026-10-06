package com.itamico.drill;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Fetches the words to drill from the itamico server (GET /api/drill). The last
 * list is kept, so a drill still starts without signal, e.g. in a tunnel.
 * Blocking: call it off the main thread.
 */
final class WordSource {
    static final class Word {
        final String italian;
        final String english;

        Word(String italian, String english) {
            this.italian = italian;
            this.english = english;
        }
    }

    static final class Result {
        final List<Word> words;
        final int due;
        final boolean fromCache;

        Result(List<Word> words, int due, boolean fromCache) {
            this.words = words;
            this.due = due;
            this.fromCache = fromCache;
        }
    }

    private static final String CACHE = "last_words_json";

    private WordSource() {}

    static Result load(Context c, Settings s, boolean allowCache) throws IOException {
        String base = s.baseUrl();
        if (base == null) throw new IOException("Paste the connector URL (https://…/mcp/TOKEN) in the Itamico Drill app.");
        try {
            String json = fetch(base + "/api/drill?limit=" + s.words, s.token());
            Result r = parse(json, false);
            Settings.prefs(c).edit().putString(CACHE, json).apply();
            return r;
        } catch (IOException | JSONException e) {
            String cached = allowCache ? Settings.prefs(c).getString(CACHE, null) : null;
            if (cached != null) {
                try {
                    Result r = parse(cached, true);
                    Collections.shuffle(r.words);
                    return r;
                } catch (JSONException ignored) {
                    // fall through to the original error
                }
            }
            if (e instanceof IOException) throw (IOException) e;
            throw new IOException("The server sent something unexpected.", e);
        }
    }

    private static String fetch(String url, String token) throws IOException {
        HttpURLConnection conn;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
        } catch (IllegalArgumentException e) {
            throw new IOException("The connector URL is not valid.", e);
        }
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(10000);
        conn.setRequestProperty("Authorization", "Bearer " + token);
        conn.setRequestProperty("Accept", "application/json");
        try {
            int code;
            try {
                code = conn.getResponseCode();
            } catch (IOException e) {
                throw new IOException("Can't reach the server (" + e.getClass().getSimpleName() + ").", e);
            }
            if (code == 401) throw new IOException("The server refused the token in the connector URL.");
            if (code == 404) throw new IOException("The server has no /api/drill yet: update and redeploy it.");
            if (code != 200) throw new IOException("The server answered HTTP " + code + ".");
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                return new String(out.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally {
            conn.disconnect();
        }
    }

    private static Result parse(String json, boolean fromCache) throws JSONException {
        JSONObject o = new JSONObject(json);
        JSONArray items = o.getJSONArray("items");
        List<Word> words = new ArrayList<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.getJSONObject(i);
            String italian = it.optString("italian").trim();
            String english = it.optString("english").trim();
            if (!italian.isEmpty() && !english.isEmpty()) words.add(new Word(italian, english));
        }
        return new Result(words, o.optInt("due"), fromCache);
    }
}
