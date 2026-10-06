package com.itamico.drill;

import android.app.Activity;
import android.content.ComponentName;
import android.media.MediaMetadata;
import android.media.browse.MediaBrowser;
import android.media.session.MediaController;
import android.media.session.PlaybackState;
import android.os.Bundle;
import android.widget.EditText;
import android.widget.RadioGroup;
import android.widget.TextView;
import java.io.IOException;

/**
 * Phone screen: settings, a connection test, and play controls for using the
 * drill without the car (on the bike, with headphones). In the car, the same
 * drill is started from Android Auto's media apps.
 */
public class MainActivity extends Activity {
    private EditText url;
    private EditText words;
    private EditText pause;
    private RadioGroup order;
    private TextView status;

    private MediaBrowser browser;
    private MediaController controller;

    private final MediaController.Callback onChange = new MediaController.Callback() {
        @Override
        public void onPlaybackStateChanged(PlaybackState state) {
            render();
        }

        @Override
        public void onMetadataChanged(MediaMetadata metadata) {
            render();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        // Edge-to-edge is enforced from Android 15: keep the form clear of the system bars.
        findViewById(R.id.root).setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });

        url = findViewById(R.id.url);
        words = findViewById(R.id.words);
        pause = findViewById(R.id.pause);
        order = findViewById(R.id.order);
        status = findViewById(R.id.status);

        Settings s = Settings.load(this);
        url.setText(s.connectorUrl);
        words.setText(String.valueOf(s.words));
        pause.setText(String.valueOf(s.pauseSec));
        order.check(Settings.ORDER_IT_EN.equals(s.order) ? R.id.order_it_en
                : Settings.ORDER_IT.equals(s.order) ? R.id.order_it : R.id.order_en_it);

        findViewById(R.id.test).setOnClickListener(v -> testConnection());
        findViewById(R.id.start).setOnClickListener(v -> {
            Settings saved = save();
            if (saved.baseUrl() == null) {
                status.setText(R.string.bad_url);
            } else if (controller != null) {
                controller.getTransportControls().playFromMediaId(DrillService.MEDIA_ID_DRILL, null);
            }
        });
        findViewById(R.id.pause_resume).setOnClickListener(v -> {
            if (controller == null) return;
            PlaybackState st = controller.getPlaybackState();
            if (st != null && st.getState() == PlaybackState.STATE_PLAYING) controller.getTransportControls().pause();
            else controller.getTransportControls().play();
        });
        findViewById(R.id.stop).setOnClickListener(v -> {
            if (controller != null) controller.getTransportControls().stop();
        });
    }

    @Override
    protected void onStart() {
        super.onStart();
        browser = new MediaBrowser(this, new ComponentName(this, DrillService.class), new MediaBrowser.ConnectionCallback() {
            @Override
            public void onConnected() {
                controller = new MediaController(MainActivity.this, browser.getSessionToken());
                controller.registerCallback(onChange);
                render();
            }
        }, null);
        browser.connect();
    }

    @Override
    protected void onPause() {
        super.onPause();
        save();
    }

    @Override
    protected void onStop() {
        if (controller != null) controller.unregisterCallback(onChange);
        controller = null;
        browser.disconnect();
        super.onStop();
    }

    private Settings save() {
        Settings s = new Settings();
        s.connectorUrl = url.getText().toString();
        s.words = parse(words, Settings.DEFAULT_WORDS);
        s.pauseSec = parse(pause, Settings.DEFAULT_PAUSE_SEC);
        int checked = order.getCheckedRadioButtonId();
        s.order = checked == R.id.order_it_en ? Settings.ORDER_IT_EN
                : checked == R.id.order_it ? Settings.ORDER_IT : Settings.ORDER_EN_IT;
        s.save(this);
        return Settings.load(this);
    }

    private static int parse(EditText e, int fallback) {
        try {
            return Integer.parseInt(e.getText().toString().trim());
        } catch (NumberFormatException ex) {
            return fallback;
        }
    }

    private void testConnection() {
        Settings s = save();
        status.setText(R.string.checking);
        new Thread(() -> {
            String msg;
            try {
                WordSource.Result r = WordSource.load(getApplicationContext(), s, false);
                msg = getString(R.string.connected, r.words.size(), r.due);
            } catch (IOException e) {
                msg = e.getMessage();
            }
            final String m = msg;
            runOnUiThread(() -> status.setText(m));
        }).start();
    }

    private void render() {
        if (controller == null) return;
        PlaybackState st = controller.getPlaybackState();
        MediaMetadata m = controller.getMetadata();
        CharSequence title = m != null ? m.getText(MediaMetadata.METADATA_KEY_TITLE) : "";
        CharSequence sub = m != null ? m.getText(MediaMetadata.METADATA_KEY_ARTIST) : "";
        int s = st != null ? st.getState() : PlaybackState.STATE_NONE;
        switch (s) {
            case PlaybackState.STATE_PLAYING:
                status.setText(getString(R.string.playing, title, sub));
                break;
            case PlaybackState.STATE_PAUSED:
                status.setText(getString(R.string.paused, title, sub));
                break;
            case PlaybackState.STATE_BUFFERING:
                status.setText(R.string.loading);
                break;
            case PlaybackState.STATE_ERROR:
                status.setText(st.getErrorMessage());
                break;
            case PlaybackState.STATE_STOPPED:
                status.setText(title);
                break;
            default:
                break;
        }
    }
}
