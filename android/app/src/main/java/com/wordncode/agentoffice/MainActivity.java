package com.wordncode.agentoffice;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.window.OnBackInvokedDispatcher;

/**
 * 에이전트 오피스 웹 UI 를 띄우는 껍데기 앱.
 * AI 실행은 컴퓨터의 serve.py(--lan)가 하고, 앱은 그 주소(접속 키 포함)를 열기만 한다.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "agent";
    private static final String KEY_URL = "server_url";
    private String DEFAULT_URL;

    private WebView web;
    private SharedPreferences prefs;
    private Updater updater;
    private long lastCheck;
    private AlertDialog urlDialog;

    // 꺼진 컴퓨터(Tailscale)로 접속하면 오류 없이 몇 분씩 검은 화면이 된다 → 15초 넘으면 주소 창
    private static final long LOAD_TIMEOUT_MS = 15_000L;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable loadTimeout = () -> {
        web.stopLoading();
        showError("응답 없음");
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        updater = new Updater(this);
        DEFAULT_URL = getString(R.string.default_url);

        // debug 서명 빌드: 컴퓨터 Chrome 의 chrome://inspect 로 화면 안을 볼 수 있게
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView v, String url, Bitmap favicon) {
                handler.removeCallbacks(loadTimeout);
                handler.postDelayed(loadTimeout, LOAD_TIMEOUT_MS);
            }

            // 서버가 응답해 화면을 그리기 시작하면 됐다(3D 자료까지 다 받는 데는 15초가 넘을 수 있다)
            @Override
            public void onPageCommitVisible(WebView v, String url) {
                handler.removeCallbacks(loadTimeout);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                handler.removeCallbacks(loadTimeout);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (!req.isForMainFrame()) return;
                handler.removeCallbacks(loadTimeout);
                showError(String.valueOf(err.getDescription()));
            }
        });
        setContentView(web);

        // Android 16(targetSdk 36)부터 뒤로 가기에 onBackPressed 가 불리지 않는다
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }

        if (state != null) web.restoreState(state);
        else web.loadUrl(url());
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 앱을 열 때(1시간에 한 번) 새 버전을 조용히 확인한다
        long now = System.currentTimeMillis();
        if (now - lastCheck > 3_600_000L) {
            lastCheck = now;
            updater.check(url(), true);
        }
    }

    @Override
    public void onBackPressed() {
        goBack();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(loadTimeout);
        super.onDestroy();
    }

    private void goBack() {
        if (web.canGoBack()) web.goBack();
        else menu();
    }

    private String url() {
        return prefs.getString(KEY_URL, DEFAULT_URL);
    }

    /** 첫 화면에서 뒤로 가기: 업데이트 확인·서버 주소 바꾸기·닫기 */
    private void menu() {
        String[] items = {"업데이트 확인 (지금 " + updater.currentVersionName() + ")", "서버 주소 바꾸기", "새로고침", "앱 닫기"};
        new AlertDialog.Builder(this)
                .setTitle("에이전트 오피스")
                .setItems(items, (d, which) -> {
                    if (which == 0) updater.check(url(), false);
                    else if (which == 1) askUrl(null);
                    else if (which == 2) web.reload();
                    else finish();
                })
                .show();
    }

    /** 서버 주소 입력 창. 컴퓨터 터미널에 나온 '휴대폰 주소'(?key=… 포함)를 붙여 넣는다. */
    private void askUrl(String message) {
        if (urlDialog != null && urlDialog.isShowing()) return;
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(prefs.getString(KEY_URL, DEFAULT_URL));
        input.setSelectAllOnFocus(true);
        urlDialog = new AlertDialog.Builder(this)
                .setTitle("서버 주소")
                .setMessage(message != null ? message
                        : "컴퓨터에서 serve.py --lan 을 켜고 나온 휴대폰 주소를 붙여 넣으세요.")
                .setView(input)
                .setCancelable(false)
                .setPositiveButton("열기", (d, w) -> {
                    String url = input.getText().toString().trim();
                    if (!url.startsWith("http")) url = "http://" + url;
                    prefs.edit().putString(KEY_URL, url).apply();
                    web.loadUrl(url);
                })
                .show();
    }

    private void showError(String why) {
        askUrl("서버에 연결하지 못했습니다(" + why + ").\n컴퓨터 서버와 Tailscale 이 켜져 있는지 확인하고, 주소를 다시 확인하세요.");
    }
}
