package com.itamico.drill;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaDescription;
import android.media.MediaMetadata;
import android.media.browse.MediaBrowser;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.service.media.MediaBrowserService;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Plays the drill: for each word the prompt, a silent pause to answer in, then
 * the answer. No grading and nothing is sent back to the server.
 *
 * A MediaBrowserService with a MediaSession, so Android Auto lists the app as a
 * media app and the steering-wheel buttons work: play/pause, next word, and
 * previous (repeat the word). The audio is TextToSpeech, not a media file.
 */
public class DrillService extends MediaBrowserService {
    static final String MEDIA_ID_DRILL = "drill";

    private static final String TAG = "DrillService";
    private static final String ROOT = "root";
    private static final String CHANNEL = "drill";
    private static final int NOTIFICATION_ID = 1;
    /** Silence after the answer, before the next word starts. */
    private static final long AFTER_ANSWER_MS = 1500;
    private static final Locale ITALIAN = Locale.ITALY;
    private static final Locale ENGLISH = Locale.US;

    private static final String ACTION_PLAY = "com.itamico.drill.PLAY";
    private static final String ACTION_PAUSE = "com.itamico.drill.PAUSE";
    private static final String ACTION_NEXT = "com.itamico.drill.NEXT";
    private static final String ACTION_STOP = "com.itamico.drill.STOP";

    private static final long ACTIONS = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP
            | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
            | PlaybackState.ACTION_PLAY_FROM_MEDIA_ID | PlaybackState.ACTION_PLAY_FROM_SEARCH;

    private static final AudioAttributes SPEECH = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();

    /** One part of a word: something to say, or a silence. */
    private static final class Step {
        final String text;
        final Locale locale;
        final long waitMs;

        private Step(String text, Locale locale, long waitMs) {
            this.text = text;
            this.locale = locale;
            this.waitMs = waitMs;
        }

        static Step say(String text, Locale locale) {
            return new Step(text, locale, 0);
        }

        static Step pause(long ms) {
            return new Step(null, null, ms);
        }
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    /** Token for the pending pause callbacks, so they can be cancelled together. */
    private final Object timer = new Object();
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private MediaSession session;
    private TextToSpeech tts;
    private boolean ttsReady;
    private String ttsProblem;
    private boolean startWhenReady;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private boolean resumeOnFocusGain;
    private boolean foreground;
    private boolean noisyRegistered;

    private Settings settings;
    private List<WordSource.Word> words = Collections.emptyList();
    private boolean offline;
    private int index; // the current word
    private int step;  // the current step within it
    /** Bumped on every pause, skip and stop; callbacks from an older generation are ignored. */
    private int generation;
    private int state = PlaybackState.STATE_NONE;
    private String error;

    /** Car or headphones disconnected: pause rather than play from the phone speaker. */
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            pause(false);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        settings = Settings.load(this);
        audio = getSystemService(AudioManager.class);
        getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(CHANNEL, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW));

        session = new MediaSession(this, TAG);
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                play();
            }

            @Override
            public void onPlayFromMediaId(String mediaId, Bundle extras) {
                startDrill();
            }

            @Override
            public void onPlayFromSearch(String query, Bundle extras) {
                startDrill();
            }

            @Override
            public void onPause() {
                pause(false);
            }

            @Override
            public void onStop() {
                stopPlayback();
            }

            @Override
            public void onSkipToNext() {
                skipTo(index + 1);
            }

            @Override
            public void onSkipToPrevious() {
                // Mid-word: hear this word again. At its start: go back one.
                skipTo(step > 0 ? index : index - 1);
            }
        });
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE));
        setSessionToken(session.getSessionToken());
        setState(PlaybackState.STATE_NONE);
        setMetadata(getString(R.string.app_name), getString(R.string.ready_subtitle));

        tts = new TextToSpeech(this, this::onTtsInit);
    }

    private void onTtsInit(int status) {
        if (status != TextToSpeech.SUCCESS) {
            ttsProblem = "Text-to-speech is not available on this phone.";
        } else {
            tts.setAudioAttributes(SPEECH);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String id) {}

                @Override
                public void onDone(String id) {
                    main.post(() -> spoken(id));
                }

                @Override
                public void onError(String id) {
                    // Don't stall the drill on one bad utterance.
                    main.post(() -> spoken(id));
                }
            });
            if (tts.isLanguageAvailable(ITALIAN) < TextToSpeech.LANG_AVAILABLE) {
                ttsProblem = "No Italian voice: install it in Settings › Text-to-speech output.";
            } else if (tts.isLanguageAvailable(ENGLISH) < TextToSpeech.LANG_AVAILABLE) {
                ttsProblem = "No English voice: install it in Settings › Text-to-speech output.";
            }
        }
        ttsReady = true;
        if (startWhenReady) {
            startWhenReady = false;
            play();
        }
    }

    // ------------------------------------------------------------- the drill

    private void startDrill() {
        halt();
        settings = Settings.load(this);
        words = Collections.emptyList();
        resumeOnFocusGain = false;
        setMetadata(getString(R.string.loading), "");
        setState(PlaybackState.STATE_BUFFERING);
        goForeground();
        final int gen = generation;
        io.execute(() -> {
            WordSource.Result result = null;
            String problem = null;
            try {
                result = WordSource.load(this, settings, true);
            } catch (IOException e) {
                problem = e.getMessage();
            }
            final WordSource.Result r = result;
            final String p = problem;
            main.post(() -> loaded(gen, r, p));
        });
    }

    private void loaded(int gen, WordSource.Result r, String problem) {
        if (gen != generation) return; // paused or stopped while loading
        if (r == null) {
            fail(problem);
        } else if (r.words.isEmpty()) {
            fail("No words to drill yet: capture some first.");
        } else {
            words = r.words;
            offline = r.fromCache;
            index = 0;
            step = 0;
            play();
        }
    }

    /** Starts a new drill, or resumes the current one from the start of its word. */
    private void play() {
        if (words.isEmpty() || index >= words.size()) {
            startDrill();
            return;
        }
        if (!ttsReady) {
            startWhenReady = true;
            setState(PlaybackState.STATE_BUFFERING);
            return;
        }
        if (ttsProblem != null) {
            fail(ttsProblem);
            return;
        }
        resumeOnFocusGain = false;
        if (!requestFocus()) {
            setState(PlaybackState.STATE_PAUSED);
            return;
        }
        halt();
        step = 0;
        session.setActive(true);
        registerNoisy();
        setState(PlaybackState.STATE_PLAYING);
        goForeground();
        runStep();
    }

    private void runStep() {
        if (state != PlaybackState.STATE_PLAYING) return;
        if (index >= words.size()) {
            finish();
            return;
        }
        List<Step> steps = steps(words.get(index));
        if (step >= steps.size()) {
            index++;
            step = 0;
            runStep();
            return;
        }
        updateMetadata();
        Step s = steps.get(step);
        if (s.text != null) {
            speak(s.text, s.locale, "s" + generation);
        } else {
            final int gen = generation;
            main.postAtTime(() -> {
                if (gen == generation) advance();
            }, timer, SystemClock.uptimeMillis() + s.waitMs);
        }
    }

    private void advance() {
        step++;
        runStep();
    }

    /** An utterance ended. Its id is a kind letter plus the generation it was spoken in. */
    private void spoken(String id) {
        if (id == null || id.length() < 2 || !id.substring(1).equals(String.valueOf(generation))) return;
        if (id.charAt(0) == 's' && state == PlaybackState.STATE_PLAYING) advance();
        else if (id.charAt(0) == 'e') stopPlayback();
    }

    private List<Step> steps(WordSource.Word w) {
        long gap = settings.pauseSec * 1000L;
        switch (settings.order) {
            case Settings.ORDER_IT_EN:
                return Arrays.asList(Step.say(w.italian, ITALIAN), Step.pause(gap),
                        Step.say(w.english, ENGLISH), Step.pause(AFTER_ANSWER_MS));
            case Settings.ORDER_IT:
                return Arrays.asList(Step.say(w.italian, ITALIAN), Step.pause(gap));
            default:
                return Arrays.asList(Step.say(w.english, ENGLISH), Step.pause(gap),
                        Step.say(w.italian, ITALIAN), Step.pause(AFTER_ANSWER_MS));
        }
    }

    private void finish() {
        int n = words.size();
        words = Collections.emptyList();
        setMetadata(getString(R.string.done_title), n + " words");
        speak("Finito!", ITALIAN, "e" + generation);
    }

    private void skipTo(int i) {
        if (words.isEmpty()) return;
        halt();
        index = Math.max(0, Math.min(i, words.size()));
        step = 0;
        if (state == PlaybackState.STATE_PLAYING) runStep();
        else if (index < words.size()) updateMetadata();
    }

    private void pause(boolean keepFocus) {
        if (state != PlaybackState.STATE_PLAYING && state != PlaybackState.STATE_BUFFERING) return;
        halt();
        startWhenReady = false;
        if (!keepFocus) {
            resumeOnFocusGain = false;
            abandonFocus();
        }
        unregisterNoisy();
        setState(PlaybackState.STATE_PAUSED);
        leaveForeground(false);
    }

    private void stopPlayback() {
        halt();
        startWhenReady = false;
        resumeOnFocusGain = false;
        words = Collections.emptyList();
        abandonFocus();
        unregisterNoisy();
        setState(PlaybackState.STATE_STOPPED);
        session.setActive(false);
        leaveForeground(true);
        stopSelf();
    }

    private void fail(String message) {
        halt();
        abandonFocus();
        unregisterNoisy();
        error = message;
        setMetadata(getString(R.string.app_name), message);
        setState(PlaybackState.STATE_ERROR);
        leaveForeground(false);
    }

    /** Silences speech and cancels pending pauses; the position is kept. */
    private void halt() {
        generation++;
        main.removeCallbacksAndMessages(timer);
        if (tts != null && ttsReady) tts.stop();
    }

    private void speak(String text, Locale locale, String id) {
        tts.setLanguage(locale);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
    }

    // -------------------------------------------------- session and display

    private void setState(int s) {
        state = s;
        PlaybackState.Builder b = new PlaybackState.Builder()
                .setActions(ACTIONS)
                .setState(s, PlaybackState.PLAYBACK_POSITION_UNKNOWN, s == PlaybackState.STATE_PLAYING ? 1f : 0f);
        if (s == PlaybackState.STATE_ERROR) b.setErrorMessage(error);
        session.setPlaybackState(b.build());
        updateNotification();
    }

    /** Title: the prompt. Subtitle: the position, and the answer once it has been said. */
    private void updateMetadata() {
        WordSource.Word w = words.get(index);
        List<Step> steps = steps(w);
        String prompt = steps.get(0).text;
        String answer = steps.size() > 2 ? steps.get(2).text : null;
        String position = (index + 1) + " / " + words.size() + (offline ? " · offline" : "");
        setMetadata(prompt, step >= 2 && answer != null ? answer + "  ·  " + position : position);
    }

    private void setMetadata(String title, String subtitle) {
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, MEDIA_ID_DRILL)
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, subtitle)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, subtitle)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, getString(R.string.app_name))
                .build());
        updateNotification();
    }

    private Notification notification() {
        MediaMetadata m = session.getController().getMetadata();
        CharSequence title = m != null ? m.getText(MediaMetadata.METADATA_KEY_TITLE) : getString(R.string.app_name);
        CharSequence text = m != null ? m.getText(MediaMetadata.METADATA_KEY_ARTIST) : "";
        boolean playing = state == PlaybackState.STATE_PLAYING || state == PlaybackState.STATE_BUFFERING;
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_drill)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(session.getController().getSessionActivity())
                .setDeleteIntent(serviceIntent(ACTION_STOP))
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(playing)
                .addAction(action(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "Pause" : "Play", playing ? ACTION_PAUSE : ACTION_PLAY))
                .addAction(action(android.R.drawable.ic_media_next, "Next word", ACTION_NEXT))
                .addAction(action(android.R.drawable.ic_menu_close_clear_cancel, "Stop", ACTION_STOP))
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1))
                .build();
    }

    private Notification.Action action(int icon, String title, String intentAction) {
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), title, serviceIntent(intentAction)).build();
    }

    private PendingIntent serviceIntent(String action) {
        Intent i = new Intent(this, DrillService.class).setAction(action);
        return PendingIntent.getService(this, action.hashCode(), i, PendingIntent.FLAG_IMMUTABLE);
    }

    private void updateNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || session == null) return;
        if (state == PlaybackState.STATE_STOPPED || state == PlaybackState.STATE_NONE) {
            nm.cancel(NOTIFICATION_ID);
        } else if (foreground || state == PlaybackState.STATE_PAUSED || state == PlaybackState.STATE_ERROR) {
            nm.notify(NOTIFICATION_ID, notification());
        }
    }

    // ----------------------------------------------- foreground and focus

    /**
     * Keeps the service alive while playing on the phone. In the car Android
     * Auto is bound to the service anyway, and starting a foreground service
     * from the background may be refused, which is fine there.
     */
    private void goForeground() {
        if (foreground) return;
        try {
            startForegroundService(new Intent(this, DrillService.class));
        } catch (RuntimeException e) {
            Log.w(TAG, "foreground service not allowed now", e);
        }
    }

    private void enterForeground() {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification());
            }
            foreground = true;
        } catch (RuntimeException e) {
            Log.w(TAG, "startForeground refused", e);
        }
    }

    private void leaveForeground(boolean removeNotification) {
        stopForeground(removeNotification ? STOP_FOREGROUND_REMOVE : STOP_FOREGROUND_DETACH);
        foreground = false;
        updateNotification();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) {
            // From goForeground(): startForeground is owed even if playback already stopped.
            enterForeground();
            if (state != PlaybackState.STATE_PLAYING && state != PlaybackState.STATE_BUFFERING) leaveForeground(false);
        } else {
            switch (action) {
                case ACTION_PLAY:
                    play();
                    break;
                case ACTION_PAUSE:
                    pause(false);
                    break;
                case ACTION_NEXT:
                    skipTo(index + 1);
                    break;
                case ACTION_STOP:
                    stopPlayback();
                    break;
                default:
                    break;
            }
        }
        return START_NOT_STICKY;
    }

    private boolean requestFocus() {
        if (focus == null) {
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(SPEECH)
                    // Pause instead of ducking: a word said under a navigation prompt is lost.
                    .setWillPauseWhenDucked(true)
                    .setOnAudioFocusChangeListener(this::onFocusChange, main)
                    .build();
        }
        return audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private void abandonFocus() {
        if (focus != null) audio.abandonAudioFocusRequest(focus);
    }

    private void onFocusChange(int change) {
        switch (change) {
            case AudioManager.AUDIOFOCUS_LOSS:
                pause(false);
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                if (state == PlaybackState.STATE_PLAYING) {
                    pause(true);
                    resumeOnFocusGain = true;
                }
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                if (resumeOnFocusGain && state == PlaybackState.STATE_PAUSED) play();
                break;
            default:
                break;
        }
    }

    private void registerNoisy() {
        if (noisyRegistered) return;
        IntentFilter f = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(noisy, f);
        noisyRegistered = true;
    }

    private void unregisterNoisy() {
        if (!noisyRegistered) return;
        unregisterReceiver(noisy);
        noisyRegistered = false;
    }

    // ------------------------------------------------------------ browsing

    @Override
    public BrowserRoot onGetRoot(String clientPackageName, int clientUid, Bundle rootHints) {
        return new BrowserRoot(ROOT, null);
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowser.MediaItem>> result) {
        List<MediaBrowser.MediaItem> items = new ArrayList<>();
        if (ROOT.equals(parentId)) {
            Settings s = Settings.load(this);
            MediaDescription d = new MediaDescription.Builder()
                    .setMediaId(MEDIA_ID_DRILL)
                    .setTitle(getString(R.string.start_drill))
                    .setSubtitle(s.words + " words · " + s.pauseSec + " s pause")
                    .build();
            items.add(new MediaBrowser.MediaItem(d, MediaBrowser.MediaItem.FLAG_PLAYABLE));
        }
        result.sendResult(items);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (state != PlaybackState.STATE_PLAYING) stopSelf();
    }

    @Override
    public void onDestroy() {
        halt();
        abandonFocus();
        unregisterNoisy();
        io.shutdownNow();
        if (tts != null) tts.shutdown();
        session.release();
        super.onDestroy();
    }
}
